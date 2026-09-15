import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Tier } from '@prisma/client';
import {
  StudentEntitlementService,
  type StudentEntitlement,
} from '../services/student-entitlement.service';
import { REQUIRES_TIER } from '../decorators/requires-tier.decorator';

/** What this guard reads. `JwtAuthGuard` sets `student`. */
interface TierRequest {
  student?: { studentId?: string };
  subscription?: StudentEntitlement;
}

/**
 * Cheapest first. A student admitted at one tier is admitted at every tier
 * below it, so Premium reaches everything Pro reaches.
 */
const TIER_RANK: Record<Tier, number> = { START: 0, PRO: 1, PREMIUM: 2 };

/**
 * Refuses a route to a student whose tier is too low for it.
 *
 * The second, narrower entitlement question. `StudentSubscriptionGuard` asks
 * whether this student's center is entitled to anything at all; this asks what
 * this particular student may do. Two students in the same center, both fully
 * paid, can now get different answers.
 *
 * A student no center governs is admitted. Independent students predate the
 * center model, hold no tier, and have the exam module today — refusing them
 * would take away something they already have for a reason that has nothing to
 * do with them. When independent paid plans arrive, this is the line that
 * changes.
 */
@Injectable()
export class StudentTierGuard implements CanActivate {
  constructor(
    private readonly entitlement: StudentEntitlementService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredTier = this.reflector.getAllAndOverride<Tier | undefined>(
      REQUIRES_TIER,
      [context.getHandler(), context.getClass()],
    );

    // No requirement declared, nothing to enforce. Defaulting to a tier here
    // would gate routes nobody meant to gate.
    if (!requiredTier) {
      return true;
    }

    const request = context.switchToHttp().getRequest<TierRequest>();
    const studentId = request.student?.studentId;

    // Nobody to look up. Whether an anonymous caller may reach a route at all
    // is JwtAuthGuard's question.
    if (!studentId) {
      return true;
    }

    const entitlement = await this.load(request, studentId);

    // No center, no tier requirement. See the class comment: this is the
    // independent student, not a governed one who happens to lack a tier.
    if (entitlement.status === 'NONE') {
      return true;
    }

    if (!this.admits(entitlement.tier, requiredTier)) {
      // Both numbers travel with the refusal. A client that knows only
      // "forbidden" can show an error; one that knows the student holds Start
      // and the route needs Pro can offer the upgrade their school has to buy.
      throw new ForbiddenException({
        message: 'TIER_TOO_LOW',
        tier: entitlement.tier,
        requiredTier,
      });
    }

    request.subscription = entitlement;
    return true;
  }

  /**
   * Reuses what another guard already fetched, and fetches otherwise.
   *
   * Reading only `request.subscription` would make this guard pass everyone
   * the moment someone reordered the decorators or dropped
   * `StudentSubscriptionGuard` — a guard that looks like protection and is
   * not. Fetching unconditionally would instead cost a second identical query
   * on every gated request.
   */
  private async load(
    request: TierRequest,
    studentId: string,
  ): Promise<StudentEntitlement> {
    if (request.subscription) {
      return request.subscription;
    }

    try {
      return await this.entitlement.forStudent(studentId);
    } catch {
      // Never a 403: a database outage is not a statement about this
      // student's tier, and dressing it up as one would tell a paying student
      // to go and buy what they already have. Never a silent pass either.
      throw new ServiceUnavailableException('SUBSCRIPTION_CHECK_UNAVAILABLE');
    }
  }

  private admits(held: Tier | null, required: Tier): boolean {
    // A governed student with no tier sits in no seat, so they clear no bar.
    if (!held) {
      return false;
    }

    return TIER_RANK[held] >= TIER_RANK[required];
  }
}
