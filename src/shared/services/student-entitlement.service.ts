import { Injectable } from '@nestjs/common';
import type { Tier } from '@prisma/client';
import { PrismaService } from './prisma.service';
import {
  SubscriptionPolicyService,
  type CenterSubscriptionStatus,
  type CenterSubscriptionRecord,
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
  /**
   * Which tier's seat this student occupies, and therefore what they may do.
   *
   * Null whenever no center governs them, even if the row still carries a
   * value: `students.center_id` is ON DELETE SET NULL while `students.tier` is
   * not, so a deleted center leaves the tier behind. Reading it without a
   * center would hand a student Premium for ever on the strength of a row
   * nobody governs. Also null for a governed student provisioned before tiers
   * existed — they sit in no seat, which is different from sitting in the
   * cheapest one.
   */
  tier: Tier | null;
}

const UNGOVERNED: StudentEntitlement = {
  status: 'NONE',
  studentsMayLearn: true,
  graceEndsAt: null,
  tier: null,
};

/** One row per student, or none at all if the student is gone. */
interface EntitlementRow {
  center_id: string | null;
  plan: CenterSubscriptionRecord['plan'] | null;
  trial_started_at: Date | null;
  trial_ends_at: Date | null;
  paid_until: Date | null;
  tier: Tier | null;
}

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
    // Deliberately one SQL statement, and deliberately not a nested `select`.
    //
    // The obvious Prisma version — findUnique with center.subscription nested
    // — reads as one query but issues THREE: students, then centers, then
    // center_subscriptions. Measured against the scratch branch, that was
    // 154ms against a 41ms round trip. This runs on every single learning
    // request, so it is three round trips per request rather than one.
    //
    // The centers table is skipped entirely: center_id carries ON DELETE SET
    // NULL, so it cannot dangle, and nothing here needs the center itself.
    const rows = await this.prisma.$queryRaw<EntitlementRow[]>`
      SELECT s.center_id,
             cs.plan::text AS plan,
             cs.trial_started_at,
             cs.trial_ends_at,
             cs.paid_until,
             s.tier::text AS tier
        FROM students s
        LEFT JOIN center_subscriptions cs ON cs.center_id = s.center_id
       WHERE s.id = ${studentId}
    `;

    const row = rows[0];

    // No row, or no center: nobody's subscription governs this student.
    if (!row?.center_id) {
      return UNGOVERNED;
    }

    // Every center is created with a subscription row, so its absence is a
    // data fault rather than a state. Fail closed: the student does belong to
    // a center, and no row means nothing authorises the access.
    //
    // `plan` is NOT NULL in the table, so a null here means the LEFT JOIN
    // found nothing. It used to be tested alongside `seats` for the same
    // reason; that column is gone, and one NOT NULL column is all the check
    // ever needed.
    if (row.plan === null) {
      // No tier either. Nothing authorises this access, so nothing about what
      // the student may do should be reported as settled.
      return {
        status: 'BLOCKED',
        studentsMayLearn: false,
        graceEndsAt: null,
        tier: null,
      };
    }

    const decision = this.policy.evaluate({
      plan: row.plan,
      trial_started_at: row.trial_started_at,
      trial_ends_at: row.trial_ends_at,
      paid_until: row.paid_until,
    });

    return {
      status: decision.status,
      studentsMayLearn: decision.studentsMayLearn,
      graceEndsAt: decision.graceEndsAt,
      // Only ever read alongside a center, which the `center_id` check above
      // has already established.
      tier: row.tier,
    };
  }
}
