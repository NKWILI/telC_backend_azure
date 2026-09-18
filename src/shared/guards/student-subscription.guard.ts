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

    // A token with no student names nobody to look up. Note this is not the
    // guest case: a guest token does carry a real studentId, so guests are
    // looked up like anyone else and pass because they have no center.
    // Whether guests may reach a route at all is a separate question, and not
    // one this guard answers.
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
      // One error for every way access can be missing (D19), so the app
      // catches it anywhere and sends the student to the activation screen.
      // The reason picks the sentence — "your school ended your access" is
      // not "enter your code" — and it falls back to asking for a code for a
      // reason an older app does not know. The status still travels with it,
      // so a client can tell "payment late" from "blocked".
      throw new ForbiddenException({
        message: 'ACTIVATION_REQUIRED',
        reason: entitlement.accessRefusal ?? 'NO_CODE',
        subscriptionStatus: entitlement.status,
      });
    }

    // Handlers that want to warn a student their grace period is running out
    // can read this instead of asking again.
    request.subscription = entitlement;
    return true;
  }
}
