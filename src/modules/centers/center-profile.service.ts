import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CenterAccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { PrismaService } from '../../shared/services/prisma.service';
import { CenterProfileResponseDto } from './dto/center-profile.dto';
import type { UpdateCenterProfileDto } from './dto/center-profile.dto';
import {
  deriveOnboardingState,
  type OnboardingState,
} from './center-onboarding';
import { deriveAccountState } from './center-account-state';
import { SubscriptionPolicyService } from './subscription-policy.service';
import { type CenterPlan, Tier } from '@prisma/client';

type SignedCenterIdentity = Pick<
  CenterAccessTokenPayload,
  'centerUserId' | 'centerId'
>;

/** Exactly what the policy service reads, and nothing incidental with it. */
type SubscriptionFacts = {
  plan: CenterPlan;
  trial_started_at: Date | null;
  trial_ends_at: Date | null;
  paid_until: Date | null;
};

/** Every tier present, zero included, so no client writes `?? 0`. */
type SeatsByTier = Record<Tier, number>;

@Injectable()
export class CenterProfileService {
  constructor(
    private readonly prisma: PrismaService,
    // The policy service rather than a second reading of the timestamps here:
    // two implementations of "is this center active" is how they come to
    // disagree, and the one that disagrees is the one granting free access.
    private readonly policy: SubscriptionPolicyService,
  ) {}

  /**
   * Everything the dashboard shell reads on every page: who is signed in, what
   * the center is, where it stands, and what it holds.
   *
   * One call on purpose. Split across three routes, each page would pick its
   * own combination and they would disagree halfway through a render.
   */
  async getProfile(
    identity: SignedCenterIdentity,
  ): Promise<CenterProfileResponseDto> {
    const centerUser = await this.loadOwnedUser(identity);
    const [subscription, seats] = await Promise.all([
      this.loadSubscription(identity),
      this.loadSeats(identity),
    ]);

    return this.toProfile(centerUser, subscription, seats);
  }

  async updateProfile(
    identity: SignedCenterIdentity,
    changes: UpdateCenterProfileDto,
  ): Promise<CenterProfileResponseDto> {
    const userData = this.toCenterUserData(changes);
    const centerData = this.toCenterData(changes);

    if (
      Object.keys(userData).length === 0 &&
      Object.keys(centerData).length === 0
    ) {
      throw new BadRequestException('NO_PROFILE_FIELDS_SUPPLIED');
    }

    // Prove ownership before writing. Both identifiers come from the signed
    // token, so a caller cannot reach another center's row even by guessing.
    await this.loadOwnedUser(identity);

    // PrismaPromise, not Promise: $transaction([...]) only accepts the
    // lazy query objects Prisma returns, which is what makes the batch atomic.
    const writes: Prisma.PrismaPromise<unknown>[] = [];
    if (Object.keys(userData).length > 0) {
      writes.push(
        this.prisma.centerUser.update({
          where: { id: identity.centerUserId },
          data: userData,
        }),
      );
    }
    if (Object.keys(centerData).length > 0) {
      writes.push(
        this.prisma.center.update({
          where: { id: identity.centerId },
          data: centerData,
        }),
      );
    }
    await this.prisma.$transaction(writes);

    // Re-read rather than patch the in-memory row: the response carries
    // derived state, and deriving it from what we hoped we wrote is how a
    // client ends up with a status the database disagrees with.
    return this.getProfile(identity);
  }

  /**
   * Scoped by center_user id *and* center id. Either alone would be enough to
   * find the row; together they mean a token cannot address a user outside the
   * center it was issued for, even if the two ever drift apart.
   */
  private async loadOwnedUser(identity: SignedCenterIdentity) {
    const centerUser = await this.prisma.centerUser.findFirst({
      where: { id: identity.centerUserId, center_id: identity.centerId },
      include: { center: true },
    });

    if (!centerUser) {
      throw new NotFoundException('CENTER_PROFILE_NOT_FOUND');
    }

    return centerUser;
  }

  private toCenterUserData(changes: UpdateCenterProfileDto) {
    return {
      ...(changes.firstName !== undefined && { first_name: changes.firstName }),
      ...(changes.lastName !== undefined && { last_name: changes.lastName }),
      ...(changes.phone !== undefined && { phone: changes.phone }),
    };
  }

  private toCenterData(changes: UpdateCenterProfileDto) {
    return {
      ...(changes.centerName !== undefined && { name: changes.centerName }),
      ...(changes.country !== undefined && { country: changes.country }),
      ...(changes.city !== undefined && { city: changes.city }),
      ...(changes.logoUrl !== undefined && { logo_url: changes.logoUrl }),
    };
  }

  /**
   * Built field by field rather than by spreading the row, so a column added
   * to the schema later cannot leak into an API response by default.
   */
  private toProfile(
    centerUser: {
      id: string;
      role: string;
      first_name: string;
      last_name: string;
      email: string;
      // Nullable because registration no longer collects them. A center that has
      // not finished onboarding genuinely has no country, city or manager phone,
      // and the response says so rather than inventing an empty string.
      phone: string | null;
      email_verified: boolean;
      center: {
        id: string;
        name: string;
        country: string | null;
        city: string | null;
        logo_url: string | null;
      };
    },
    subscription: SubscriptionFacts,
    seats: SeatsByTier,
  ): CenterProfileResponseDto {
    const onboarding = this.toOnboardingState(centerUser);
    const decision = this.policy.evaluate(subscription);

    return {
      centerUser: {
        id: centerUser.id,
        role: centerUser.role as CenterProfileResponseDto['centerUser']['role'],
        firstName: centerUser.first_name,
        lastName: centerUser.last_name,
        email: centerUser.email,
        phone: centerUser.phone,
        emailVerified: centerUser.email_verified,
      },
      center: {
        id: centerUser.center.id,
        name: centerUser.center.name,
        country: centerUser.center.country,
        city: centerUser.center.city,
        logoUrl: centerUser.center.logo_url,
      },
      onboarding,
      account: {
        ...deriveAccountState({
          subscriptionStatus: decision.status,
          trialStartedAt: subscription.trial_started_at,
          paidUntil: subscription.paid_until,
          onboarding,
        }),
        // Carried alongside the coarse `paymentStatus` because "payment late"
        // and "blocked" are different sentences to a manager, and only this
        // tells them apart.
        subscriptionStatus: decision.status,
        trialEndsAt: subscription.trial_ends_at,
        paidUntil: subscription.paid_until,
        graceEndsAt: decision.graceEndsAt,
        studentsMayLearn: decision.studentsMayLearn,
        seats,
      },
    };
  }

  /**
   * Every center gets a subscription inside its registration transaction, so a
   * missing row is a fault to surface rather than a state to accommodate —
   * the same stance `CenterSubscriptionService` takes.
   */
  private async loadSubscription(
    identity: SignedCenterIdentity,
  ): Promise<SubscriptionFacts> {
    const subscription = await this.prisma.centerSubscription.findUnique({
      where: { center_id: identity.centerId },
      // Named columns, not the row: the policy must not start depending on
      // ids or timestamps that happen to travel with it.
      select: {
        plan: true,
        trial_started_at: true,
        trial_ends_at: true,
        paid_until: true,
      },
    });

    if (!subscription) {
      throw new NotFoundException('CENTER_SUBSCRIPTION_NOT_FOUND');
    }

    return subscription;
  }

  /**
   * Seats per tier, with absent tiers reported as zero.
   *
   * A tier with no row and a tier with zero seats mean the same thing to a
   * dashboard, and leaving one of them undefined makes every client write the
   * same `?? 0`.
   */
  private async loadSeats(
    identity: SignedCenterIdentity,
  ): Promise<SeatsByTier> {
    const rows = await this.prisma.centerSeat.findMany({
      where: { center_id: identity.centerId },
      select: { tier: true, quantity: true },
    });

    const seats: SeatsByTier = {
      [Tier.START]: 0,
      [Tier.PRO]: 0,
      [Tier.PREMIUM]: 0,
    };

    for (const row of rows) {
      seats[row.tier] = row.quantity;
    }

    return seats;
  }

  /**
   * Worked out on every read rather than stored.
   *
   * A stored flag needs a job or a trigger to keep it true, and when that runs
   * late the value is wrong — the same reasoning that left subscription status
   * derived from timestamps. This cannot drift, because there is nothing to
   * drift from.
   *
   * `missing` is reported so the dashboard renders its checklist without
   * holding a second copy of these rules. A fourth required field added here
   * updates every checklist with no frontend change, and the client never ends
   * up with a rival definition of "complete".
   */
  private toOnboardingState(centerUser: {
    phone: string | null;
    center: { country: string | null; city: string | null };
  }): OnboardingState {
    // The rules live in `center-onboarding` because payment creation asks the
    // same question, and a second copy here is the one that would drift.
    return deriveOnboardingState({
      country: centerUser.center.country,
      city: centerUser.center.city,
      phone: centerUser.phone,
    });
  }
}
