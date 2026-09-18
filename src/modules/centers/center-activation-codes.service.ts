import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActivationCodeStatus,
  type ActivationCode,
  type Prisma,
  Tier,
} from '@prisma/client';
import type { CenterAccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { PrismaService } from '../../shared/services/prisma.service';
import {
  TIER_ORDER,
  emptySeatsByPlan,
  planIdFor,
  type PlanId,
  type SeatsByPlan,
} from '../../shared/plan-id';
import {
  toActivationCodeView,
  type ActivationCodeView,
} from './activation-code-view';
import { isAccountFinalized } from './center-account-state';

type SignedCenterIdentity = Pick<
  CenterAccessTokenPayload,
  'centerUserId' | 'centerId'
>;

export type CodeStatusFilter =
  | 'activated'
  | 'connected'
  | 'deactivated'
  | 'all';

export interface CodeListFilters {
  status?: CodeStatusFilter;
  planId?: PlanId | 'all';
}

export interface SeatSummary {
  bought: SeatsByPlan;
  used: SeatsByPlan;
  boughtTotal: number;
  usedTotal: number;
}

const STATUS_FILTER: Record<
  Exclude<CodeStatusFilter, 'all'>,
  ActivationCodeStatus
> = {
  activated: ActivationCodeStatus.ACTIVATED,
  connected: ActivationCodeStatus.CONNECTED,
  deactivated: ActivationCodeStatus.DEACTIVATED,
};

const TIER_FILTER: Record<PlanId, Tier> = {
  start: Tier.START,
  pro: Tier.PRO,
  premium: Tier.PREMIUM,
};

/**
 * One allowed move of a code, as a manager makes it.
 *
 * Declared as data rather than branches so the whole of what a center may do
 * to a code is readable in one place. Anything not listed is refused.
 */
interface Transition {
  from: ActivationCodeStatus[];
  to: ActivationCodeStatus;
  /** What else the row loses when it makes this move. */
  alsoWrite: Prisma.ActivationCodeUpdateManyMutationInput;
}

const DEACTIVATE: Transition = {
  from: [ActivationCodeStatus.ACTIVATED, ActivationCodeStatus.CONNECTED],
  to: ActivationCodeStatus.DEACTIVATED,
  // The student's name and email stay on the code: a manager looking at a
  // deactivated seat needs to see whose it was. The link is broken on the
  // student's side instead, which is what actually ends their access.
  alsoWrite: {},
};

const ACTIVATE: Transition = {
  from: [ActivationCodeStatus.DEACTIVATED],
  to: ActivationCodeStatus.ACTIVATED,
  // A reactivated code is a free seat again, so it forgets who held it. The
  // history is not lost: it lives in the event log.
  alsoWrite: {
    student_id: null,
    linked_name: null,
    linked_email: null,
    connected_at: null,
    connected_ip: null,
  },
};

/**
 * The Users page: a center's codes, its seat count, and the two things it may
 * do to a code.
 *
 * There is deliberately no create and no delete. Codes exist because a trial
 * started or a payment succeeded; a route that made one by hand would let the
 * number of codes drift away from the number of seats paid for.
 */
@Injectable()
export class CenterActivationCodesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A center's codes, newest first, optionally narrowed.
   *
   * Reading is never locked: an unfinalized or blocked center may still see
   * what it holds, because seeing it is how it decides to pay.
   */
  async list(
    identity: SignedCenterIdentity,
    filters: CodeListFilters,
  ): Promise<ActivationCodeView[]> {
    const where: Prisma.ActivationCodeWhereInput = {
      center_id: identity.centerId,
    };

    if (filters.status && filters.status !== 'all') {
      where.status = STATUS_FILTER[filters.status];
    }

    if (filters.planId && filters.planId !== 'all') {
      where.tier = TIER_FILTER[filters.planId];
    }

    const rows = await this.prisma.activationCode.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });

    return rows.map(toActivationCodeView);
  }

  /**
   * Seats bought against seats in use, per plan.
   *
   * Bought comes from the seat rows, which payment activation owns; used is
   * the number of codes a student has redeemed. Deriving "used" from codes
   * rather than from a counter means it cannot drift from what the Users page
   * lists.
   */
  async seats(identity: SignedCenterIdentity): Promise<SeatSummary> {
    const [seatRows, usedRows] = await Promise.all([
      this.prisma.centerSeat.findMany({
        where: { center_id: identity.centerId },
        select: { tier: true, quantity: true },
      }),
      this.prisma.activationCode.groupBy({
        by: ['tier'],
        where: {
          center_id: identity.centerId,
          status: ActivationCodeStatus.CONNECTED,
        },
        _count: { _all: true },
      }),
    ]);

    const bought = emptySeatsByPlan();
    const used = emptySeatsByPlan();

    for (const row of seatRows) {
      bought[planIdFor(row.tier)] = row.quantity;
    }

    for (const row of usedRows) {
      used[planIdFor(row.tier)] = row._count._all;
    }

    const total = (seats: SeatsByPlan) =>
      TIER_ORDER.reduce((sum, tier) => sum + seats[planIdFor(tier)], 0);

    return {
      bought,
      used,
      boughtTotal: total(bought),
      usedTotal: total(used),
    };
  }

  async deactivate(
    identity: SignedCenterIdentity,
    codeId: string,
  ): Promise<ActivationCodeView> {
    return this.move(identity, codeId, DEACTIVATE);
  }

  async activate(
    identity: SignedCenterIdentity,
    codeId: string,
  ): Promise<ActivationCodeView> {
    return this.move(identity, codeId, ACTIVATE);
  }

  /**
   * Moves one code, exactly once, and records it.
   *
   * The move is a predicated update — only a code still in an allowed state
   * changes — so a double click, or two managers acting at once, moves it one
   * time. Asking for a state the code is already in answers with the code
   * rather than an error: the manager wanted it there, and it is there.
   */
  private async move(
    identity: SignedCenterIdentity,
    codeId: string,
    transition: Transition,
  ): Promise<ActivationCodeView> {
    await this.requireFinalized(identity);

    const current = await this.loadOwnedCode(identity, codeId);

    if (current.status === transition.to) {
      return toActivationCodeView(current);
    }

    if (!transition.from.includes(current.status)) {
      throw new ConflictException('INVALID_CODE_TRANSITION');
    }

    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.activationCode.updateMany({
        where: {
          id: codeId,
          center_id: identity.centerId,
          status: { in: transition.from },
        },
        data: { status: transition.to, ...transition.alsoWrite },
      });

      // Someone else moved it between the read and this write. Nothing is
      // logged for a change this request did not make.
      if (moved.count !== 1) {
        return;
      }

      // Access ends on the student's side, and only for THIS center's hold on
      // them: a student who has since joined another school keeps that one.
      if (
        transition.to === ActivationCodeStatus.DEACTIVATED &&
        current.student_id
      ) {
        await tx.student.updateMany({
          where: { id: current.student_id, center_id: identity.centerId },
          data: { center_id: null, tier: null },
        });
      }

      await tx.activationCodeEvent.create({
        data: {
          code_id: codeId,
          center_id: identity.centerId,
          center_user_id: identity.centerUserId,
          from_status: current.status,
          to_status: transition.to,
          student_id: current.student_id,
        },
      });
    });

    return toActivationCodeView(await this.loadOwnedCode(identity, codeId));
  }

  /**
   * A paid action needs a finalized account.
   *
   * The same rule the dashboard badge reads (`isAccountFinalized`), so the
   * page and the API cannot disagree about whether this center may act. A
   * blocked center is refused earlier, by `CenterSubscriptionGuard`.
   */
  private async requireFinalized(
    identity: SignedCenterIdentity,
  ): Promise<void> {
    const subscription = await this.prisma.centerSubscription.findUnique({
      where: { center_id: identity.centerId },
      select: { trial_started_at: true, paid_until: true },
    });

    if (
      !subscription ||
      !isAccountFinalized({
        trialStartedAt: subscription.trial_started_at,
        paidUntil: subscription.paid_until,
      })
    ) {
      throw new ForbiddenException('ACCOUNT_NOT_FINALIZED');
    }
  }

  /**
   * Scoped by center as well as id, and answered 404 either way: a 403 would
   * confirm that another center's code id exists.
   */
  private async loadOwnedCode(
    identity: SignedCenterIdentity,
    codeId: string,
  ): Promise<ActivationCode> {
    const code = await this.prisma.activationCode.findFirst({
      where: { id: codeId, center_id: identity.centerId },
    });

    if (!code) {
      throw new NotFoundException('CODE_NOT_FOUND');
    }

    return code;
  }
}
