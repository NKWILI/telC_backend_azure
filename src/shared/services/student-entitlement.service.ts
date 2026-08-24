import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import {
  SubscriptionPolicyService,
  type CenterSubscriptionStatus,
} from '../../modules/centers/subscription-policy.service';

/**
 * `NONE` is not one of the policy's states. It means no center governs this
 * student at all — they predate the center model, or were removed from one.
 * It is kept distinct from `BLOCKED` because a client must be able to tell
 * "you have no school" from "your school stopped paying"; only the second is
 * worth offering to fix.
 */
export type StudentEntitlementStatus = CenterSubscriptionStatus | 'NONE';

export interface StudentEntitlement {
  status: StudentEntitlementStatus;
  studentsMayLearn: boolean;
  graceEndsAt: Date | null;
}

const UNGOVERNED: StudentEntitlement = {
  status: 'NONE',
  studentsMayLearn: true,
  graceEndsAt: null,
};

/** Selected in one query, so an entitlement costs one round trip. */
const ENTITLEMENT_SELECT = {
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
 * Answers "may this student learn, and why" in one place.
 *
 * Both the guard and the auth responses need this. Written twice it would
 * drift, and the two copies would disagree about a blocked student in exactly
 * the situation where a clear answer matters most — so it is written once and
 * called from both.
 *
 * It deliberately makes no HTTP decisions. Callers choose what an outage or a
 * refusal means: the guard turns them into 503 and 403, while login reports
 * the status and carries on.
 */
@Injectable()
export class StudentEntitlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: SubscriptionPolicyService,
  ) {}

  async forStudent(studentId: string): Promise<StudentEntitlement> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: ENTITLEMENT_SELECT,
    });

    if (!student?.center_id) {
      return UNGOVERNED;
    }

    const subscription = student.center?.subscription;

    // Every center is created with a subscription row, so its absence is a
    // data fault rather than a state. Fail closed: the student does belong to
    // a center, and no row means nothing authorises the access.
    if (!subscription) {
      return { status: 'BLOCKED', studentsMayLearn: false, graceEndsAt: null };
    }

    const decision = this.policy.evaluate(subscription);

    return {
      status: decision.status,
      studentsMayLearn: decision.studentsMayLearn,
      graceEndsAt: decision.graceEndsAt,
    };
  }
}
