import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivationCodeStatus, Prisma, type CenterPlan } from '@prisma/client';
import { PrismaService } from '../../shared/services/prisma.service';
import { planIdFor, type PlanId } from '../../shared/plan-id';
import { normalizeActivationCode } from './activation-code-format';
import { SubscriptionPolicyService } from './subscription-policy.service';

export interface RedemptionResult {
  planId: PlanId;
  centerName: string;
  /** When this seat stops, or null when it follows the center's subscription. */
  expiresAt: Date | null;
}

interface CenterFacts {
  name: string;
  subscription: {
    plan: CenterPlan;
    trial_started_at: Date | null;
    trial_ends_at: Date | null;
    paid_until: Date | null;
  } | null;
}

/**
 * A student turning a code into access.
 *
 * Done once. After this the student simply logs in, and whether access still
 * holds is read on every request — so what this service guarantees is narrow:
 * one code becomes one student's, exactly once, and only while it is worth
 * something.
 */
@Injectable()
export class CodeRedemptionService {
  constructor(
    private readonly prisma: PrismaService,
    // The same policy the rest of the system reads. A second opinion on
    // "is this center active" is how one path grants what the other refuses.
    private readonly policy: SubscriptionPolicyService,
  ) {}

  async redeem(
    student: { studentId: string },
    typed: string,
    ip: string | undefined,
  ): Promise<RedemptionResult> {
    const value = normalizeActivationCode(typed);

    // Malformed and unknown get the same answer, so the response cannot be
    // used to learn which shapes are real codes.
    if (!value) {
      throw new BadRequestException('CODE_INVALID');
    }

    const code = await this.prisma.activationCode.findUnique({
      where: { code: value },
      include: {
        center: {
          select: {
            name: true,
            subscription: {
              select: {
                plan: true,
                trial_started_at: true,
                trial_ends_at: true,
                paid_until: true,
              },
            },
          },
        },
      },
    });

    if (!code) {
      throw new BadRequestException('CODE_INVALID');
    }

    // Re-entering one's own code is a student confused about whether it
    // worked, not an attack. Answer with what they already have.
    if (
      code.status === ActivationCodeStatus.CONNECTED &&
      code.student_id === student.studentId
    ) {
      return this.toResult(code.tier, code.center, code.expires_at);
    }

    if (code.status === ActivationCodeStatus.CONNECTED) {
      throw new ConflictException('CODE_ALREADY_USED');
    }

    if (code.status === ActivationCodeStatus.DEACTIVATED) {
      throw new ConflictException('CODE_DEACTIVATED');
    }

    if (code.expires_at !== null && code.expires_at <= new Date()) {
      throw new BadRequestException('CODE_EXPIRED');
    }

    // A code is only worth what its center is paying for. Without this, a
    // lapsed center's unused codes would keep letting new students in.
    if (
      !code.center.subscription ||
      !this.policy.evaluate(code.center.subscription).studentsMayLearn
    ) {
      throw new ForbiddenException('CENTER_NOT_ACTIVE');
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // Everything that decides whether this student may take a seat is read
        // HERE, inside the transaction that takes it. Checked outside, two
        // requests could both pass before either wrote — and the database rule
        // below is what finally settles that race.
        const holder = await tx.student.findUnique({
          where: { id: student.studentId },
          select: {
            first_name: true,
            last_name: true,
            email: true,
            center_id: true,
            center: {
              select: {
                subscription: {
                  select: {
                    plan: true,
                    trial_started_at: true,
                    trial_ends_at: true,
                    paid_until: true,
                  },
                },
              },
            },
          },
        });

        if (!holder) {
          throw new NotFoundException('STUDENT_NOT_FOUND');
        }

        // A student an older per-student key still ties to a paying school has
        // a seat but no code, so looking only at codes would miss them — and
        // redeeming would silently move them, possibly to a lower tier.
        // Refused rather than switched: the usual cause is a mistake, and
        // moving a student between schools is the schools' job. A school that
        // has lapsed no longer holds them, so joining a new one is allowed.
        if (holder.center_id && this.isLive(holder.center?.subscription)) {
          throw new ConflictException('STUDENT_ALREADY_ACTIVE');
        }

        await this.releaseDeadCodes(tx, student.studentId);

        // The gate. Only a code still waiting moves, so of two students sending
        // the same code at the same moment exactly one wins.
        const claimed = await tx.activationCode.updateMany({
          where: { id: code.id, status: ActivationCodeStatus.ACTIVATED },
          data: {
            status: ActivationCodeStatus.CONNECTED,
            student_id: student.studentId,
            // Copied rather than joined, so the center still sees who held the
            // seat after the student changes their name or leaves.
            linked_name:
              [holder.first_name, holder.last_name].filter(Boolean).join(' ') ||
              null,
            linked_email: holder.email,
            connected_at: new Date(),
            // A center holds its codes and can redeem one itself. This is the
            // trace that makes that visible afterwards.
            connected_ip: ip ?? null,
          },
        });

        if (claimed.count !== 1) {
          throw new ConflictException('CODE_ALREADY_USED');
        }

        // What access is read from on every request. Set in the same
        // transaction as the claim, so a code can never be taken without the
        // student actually getting the seat.
        await tx.student.update({
          where: { id: student.studentId },
          data: { center_id: code.center_id, tier: code.tier },
        });

        await tx.activationCodeEvent.create({
          data: {
            code_id: code.id,
            center_id: code.center_id,
            // Nobody at the center acted: the student did.
            center_user_id: null,
            from_status: ActivationCodeStatus.ACTIVATED,
            to_status: ActivationCodeStatus.CONNECTED,
            student_id: student.studentId,
          },
        });
      });
    } catch (error) {
      // The database allows one connected code per student. A second request
      // that raced this one past every check above lands here, and the student
      // hears the same thing they would have heard had it arrived later.
      if (this.isSecondConnectedCode(error)) {
        throw new ConflictException('STUDENT_ALREADY_ACTIVE');
      }
      throw error;
    }

    return this.toResult(code.tier, code.center, code.expires_at);
  }

  /**
   * Frees the student's codes that no longer give access, so a new one can be
   * redeemed.
   *
   * One connected code per student is a database rule, so a code that stopped
   * working — its date passed, or its school stopped paying — would otherwise
   * lock the student out of the very redemption meant to replace it. A code
   * that still works is left alone, and the student is told they already have
   * one.
   */
  private async releaseDeadCodes(
    tx: Prisma.TransactionClient,
    studentId: string,
  ): Promise<void> {
    const held = await tx.activationCode.findMany({
      where: { student_id: studentId, status: ActivationCodeStatus.CONNECTED },
      include: {
        center: {
          select: {
            subscription: {
              select: {
                plan: true,
                trial_started_at: true,
                trial_ends_at: true,
                paid_until: true,
              },
            },
          },
        },
      },
    });

    const now = new Date();

    for (const code of held) {
      const expired = code.expires_at !== null && code.expires_at <= now;

      if (!expired && this.isLive(code.center.subscription)) {
        throw new ConflictException('STUDENT_ALREADY_ACTIVE');
      }

      const released = await tx.activationCode.updateMany({
        where: { id: code.id, status: ActivationCodeStatus.CONNECTED },
        data: { status: ActivationCodeStatus.DEACTIVATED },
      });

      if (released.count === 1) {
        await tx.activationCodeEvent.create({
          data: {
            code_id: code.id,
            center_id: code.center_id,
            center_user_id: null,
            from_status: ActivationCodeStatus.CONNECTED,
            to_status: ActivationCodeStatus.DEACTIVATED,
            student_id: studentId,
          },
        });
      }
    }
  }

  /** Whether a school's subscription still lets its students learn. */
  private isLive(
    subscription: CenterFacts['subscription'] | undefined,
  ): boolean {
    return (
      !!subscription && this.policy.evaluate(subscription).studentsMayLearn
    );
  }

  /** The partial unique index on connected codes, and only that. */
  private isSecondConnectedCode(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return false;
    }

    if (error.code !== 'P2002') {
      return false;
    }

    const target = JSON.stringify(
      (error.meta as { target?: unknown } | undefined)?.target ?? '',
    );

    return target.includes('student_id') || target.includes('one_connected');
  }

  private toResult(
    tier: Parameters<typeof planIdFor>[0],
    center: CenterFacts,
    expiresAt: Date | null,
  ): RedemptionResult {
    return { planId: planIdFor(tier), centerName: center.name, expiresAt };
  }
}
