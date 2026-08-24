import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../../shared/services/prisma.service';
import {
  SubscriptionPolicyService,
  type CenterSubscriptionRecord,
} from '../subscription-policy.service';
import type { CenterAuthenticatedRequest } from './center-auth.guard';

/**
 * Stops a blocked center granting new access.
 *
 * It guards provisioning and key issuing only. A blocked center can still read
 * its profile, its subscription, its usage and its student list, and can still
 * edit its profile — because the one thing it most needs to do is pay, and
 * locking it out of its own dashboard makes that harder rather than more
 * likely. The pressure belongs on creating new access, not on the door.
 *
 * Runs after `CenterAuthGuard`, which puts `centerUser` on the request.
 */
@Injectable()
export class CenterSubscriptionGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: SubscriptionPolicyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<CenterAuthenticatedRequest>();

    const centerId = request.centerUser?.centerId;

    // CenterAuthGuard runs first and would already have rejected an
    // unauthenticated caller. Arriving here without a center means the guards
    // are misordered, and passing would turn that mistake into an open route.
    if (!centerId) {
      throw this.refuse('UNKNOWN');
    }

    // Typed as the policy's own narrow record rather than the full row, so
    // the select below and the policy input cannot drift apart silently.
    let subscription: CenterSubscriptionRecord | null;

    try {
      subscription = await this.prisma.centerSubscription.findUnique({
        where: { center_id: centerId },
        select: {
          plan: true,
          seats: true,
          trial_started_at: true,
          trial_ends_at: true,
          paid_until: true,
        },
      });
    } catch {
      // An outage is not a statement about what this center has paid for.
      throw new ServiceUnavailableException('SUBSCRIPTION_CHECK_UNAVAILABLE');
    }

    // Every center is created with a row, so its absence is a data fault
    // rather than a state. Fail closed rather than provisioning seats that
    // nothing accounts for.
    if (!subscription) {
      throw this.refuse('BLOCKED');
    }

    const decision = this.policy.evaluate(subscription);

    // centerMayProvision, not studentsMayLearn. They differ at TRIAL_PENDING,
    // where nobody may learn yet but the center must still be able to create
    // the student whose activation starts the trial.
    if (!decision.centerMayProvision) {
      throw this.refuse(decision.status);
    }

    return true;
  }

  /** The status travels with the refusal so a dashboard can say what to fix. */
  private refuse(subscriptionStatus: string): ForbiddenException {
    return new ForbiddenException({
      message: 'SUBSCRIPTION_INACTIVE',
      subscriptionStatus,
    });
  }
}
