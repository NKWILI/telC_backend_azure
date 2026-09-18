import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Tier } from '@prisma/client';
import type { CenterAccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { PrismaService } from '../../shared/services/prisma.service';
import { isUniqueViolationOn } from '../../shared/prisma-errors';
import { generateActivationCode } from './activation-code-format';
import {
  toActivationCodeView,
  type ActivationCodeView,
} from './activation-code-view';

/** The free trial lasts fourteen days — a product rule, not a default. */
export const TRIAL_DURATION_DAYS = 14;

/**
 * How many times a colliding random code is redrawn before giving up.
 *
 * At 30^8 combinations a single collision is already unlikely; three in a row
 * means something other than chance, and the caller should hear about it
 * rather than loop.
 */
const CODE_DRAW_ATTEMPTS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

type SignedCenterIdentity = Pick<
  CenterAccessTokenPayload,
  'centerUserId' | 'centerId'
>;

export interface TrialStarted {
  trialEndsAt: Date;
  code: ActivationCodeView;
}

/**
 * Starts a center's free trial: the clock, and the one code that goes with it.
 *
 * The clock starts HERE, when the manager presses the button, rather than at a
 * student's first redemption. A school should know when its trial ends the
 * moment it has a code to hand out, and the code's expiry is that same date —
 * two clocks that could disagree would be one too many.
 *
 * The trial's seat already exists: registration creates it as a Start seat at
 * zero price. What this adds is the date and the value a student types.
 */
@Injectable()
export class CenterTrialService {
  constructor(private readonly prisma: PrismaService) {}

  async start(identity: SignedCenterIdentity): Promise<TrialStarted> {
    const subscription = await this.prisma.centerSubscription.findUnique({
      where: { center_id: identity.centerId },
      select: { trial_started_at: true, paid_until: true },
    });

    if (!subscription) {
      throw new NotFoundException('CENTER_SUBSCRIPTION_NOT_FOUND');
    }

    // Paid first: a center that has bought seats is past the trial, and saying
    // "trial already used" to one that never took it would be untrue.
    if (subscription.paid_until !== null) {
      throw new ConflictException('ALREADY_PAID');
    }

    // Includes every center whose trial the old activation-key path started.
    // Their clock is never touched here, so moving the start of the trial to
    // this button cannot restart a trial that is already running.
    if (subscription.trial_started_at !== null) {
      throw new ConflictException('TRIAL_ALREADY_USED');
    }

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.claimTrial(identity.centerId);
      } catch (error) {
        if (
          !isUniqueViolationOn(error, 'code') ||
          attempt >= CODE_DRAW_ATTEMPTS
        ) {
          throw error;
        }
        // The transaction rolled back with the collision, trial claim
        // included, so the next attempt starts from exactly the same state.
      }
    }
  }

  /**
   * One transaction: claim the trial, then issue its code.
   *
   * Together so a trial can never exist without its code or a code without its
   * trial. The claim is a predicated update — only a subscription with no
   * trial and no payment moves — so two presses of the button arriving at once
   * start one trial, and the loser is told so instead of getting a second code.
   */
  private async claimTrial(centerId: string): Promise<TrialStarted> {
    return this.prisma.$transaction(async (tx) => {
      const startedAt = new Date();
      const endsAt = new Date(
        startedAt.getTime() + TRIAL_DURATION_DAYS * DAY_MS,
      );

      const claimed = await tx.centerSubscription.updateMany({
        where: {
          center_id: centerId,
          trial_started_at: null,
          paid_until: null,
        },
        data: { trial_started_at: startedAt, trial_ends_at: endsAt },
      });

      if (claimed.count !== 1) {
        throw new ConflictException('TRIAL_ALREADY_USED');
      }

      const code = await tx.activationCode.create({
        data: {
          center_id: centerId,
          code: generateActivationCode(),
          // A trial seat is an ordinary Start seat at zero price, so a trial
          // student and a paid Start student differ only in the clock.
          tier: Tier.START,
          expires_at: endsAt,
        },
      });

      return { trialEndsAt: endsAt, code: toActivationCodeView(code) };
    });
  }
}
