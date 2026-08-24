import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  StudentEntitlementService,
  type StudentEntitlement,
} from '../services/student-entitlement.service';

/** What this guard reads and writes. `JwtAuthGuard` sets `student`. */
interface SubscriptionRequest {
  student?: { studentId?: string };
  subscription?: StudentEntitlement;
}

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
 *
 * Whether they may learn is `StudentEntitlementService`'s question, not this
 * guard's. All that belongs here is turning its answer into an HTTP one.
 */
@Injectable()
export class StudentSubscriptionGuard implements CanActivate {
  constructor(private readonly entitlement: StudentEntitlementService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SubscriptionRequest>();
    const studentId = request.student?.studentId;

    // A guest token names no student, so there is no center and no
    // subscription to consult. Whether guests may reach a route at all is
    // GuestBlockGuard's question, not this one.
    if (!studentId) {
      return true;
    }

    let entitlement: StudentEntitlement;

    try {
      entitlement = await this.entitlement.forStudent(studentId);
    } catch {
      // Never a 403 here: a database outage is not a statement about this
      // student's entitlement, and dressing it up as one would tell a paying
      // customer their subscription lapsed. Never a silent pass either.
      throw new ServiceUnavailableException('SUBSCRIPTION_CHECK_UNAVAILABLE');
    }

    if (!entitlement.studentsMayLearn) {
      // The status travels with the refusal on purpose. A client that only
      // knows "forbidden" can do nothing but show an error, whereas one that
      // knows the center stopped paying can offer the student a way to carry
      // on themselves.
      throw new ForbiddenException({
        message: 'SUBSCRIPTION_INACTIVE',
        subscriptionStatus: entitlement.status,
      });
    }

    // Handlers that want to warn a student their grace period is running out
    // can read this instead of asking again.
    request.subscription = entitlement;
    return true;
  }
}
