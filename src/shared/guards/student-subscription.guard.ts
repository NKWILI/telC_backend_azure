import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../services/prisma.service';
import {
  SubscriptionPolicyService,
  type CenterSubscriptionRecord,
  type SubscriptionDecision,
} from '../../modules/centers/subscription-policy.service';

/** What this guard reads and writes. `JwtAuthGuard` sets `student`. */
interface SubscriptionRequest {
  student?: { studentId?: string };
  subscription?: SubscriptionDecision;
}

/** Selected in one query, so enforcing a subscription costs one round trip. */
const SUBSCRIPTION_SELECT = {
  center_id: true,
  center: {
    select: {
      subscription: {
        select: {
          plan: true,
          seats: true,
          trial_started_at: true,
          trial_ends_at: true,
          paid_until: true,
        },
      },
    },
  },
} as const;

/**
 * Refuses learning to a student whose center is not entitled to it.
 *
 * Runs after `JwtAuthGuard`, which is what puts `request.student` there. The
 * two are deliberately separate: `JwtAuthGuard` answers "who is this", this
 * one answers "may they learn today". Keeping them apart is why a blocked
 * student gets a 403 and not a 401 — they are perfectly authenticated, and
 * telling them to log in again would send them round a loop that cannot help.
 *
 * The check runs on every request rather than at login. A student blocked on
 * Monday must not keep working until their token happens to expire on Friday.
 */
@Injectable()
export class StudentSubscriptionGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: SubscriptionPolicyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SubscriptionRequest>();
    const studentId = request.student?.studentId;

    // A guest token names no student, so there is no center and no
    // subscription to consult. Whether guests may reach a route at all is
    // GuestBlockGuard's question, not this one.
    if (!studentId) {
      return true;
    }

    let student: {
      center_id: string | null;
      center: { subscription: CenterSubscriptionRecord | null } | null;
    } | null;

    try {
      student = await this.prisma.student.findUnique({
        where: { id: studentId },
        select: SUBSCRIPTION_SELECT,
      });
    } catch {
      // Never a 403 here: a database outage is not a statement about this
      // student's entitlement, and dressing it up as one would tell a paying
      // customer their subscription lapsed. Never a silent pass either.
      throw new ServiceUnavailableException('SUBSCRIPTION_CHECK_UNAVAILABLE');
    }

    // No row, or no center: nobody's subscription governs this student. That
    // covers everyone who predates the center model and anyone a center has
    // since removed, who must keep the account they already had.
    if (!student?.center_id) {
      return true;
    }

    const subscription = student.center?.subscription;

    // Every center is created with a subscription row, so its absence is a
    // data fault rather than a state. Fail closed: the student does belong to
    // a center, and no row means nothing authorises the access.
    if (!subscription) {
      throw this.inactive('BLOCKED');
    }

    const decision = this.policy.evaluate(subscription);

    if (!decision.studentsMayLearn) {
      throw this.inactive(decision.status);
    }

    // Handlers that want to warn a student their grace period is running out
    // can read this instead of asking again.
    request.subscription = decision;
    return true;
  }

  /**
   * The status travels with the refusal on purpose. A client that only knows
   * "forbidden" can do nothing but show an error, whereas one that knows the
   * center stopped paying can offer the student a way to carry on themselves.
   */
  private inactive(subscriptionStatus: string): ForbiddenException {
    return new ForbiddenException({
      message: 'SUBSCRIPTION_INACTIVE',
      subscriptionStatus,
    });
  }
}
