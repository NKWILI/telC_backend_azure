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
  /**
   * Whether a `students` row exists for this id at all.
   *
   * False for a guest token: `/api/auth/guest` mints a random uuid and writes
   * nothing. Such a caller cannot be metered — an `ai_usage` insert for them
   * fails on the foreign key — so anything that spends money must be able to
   * see that rather than be handed an allowance it can never count against.
   */
  studentExists: boolean;
  /**
   * Whether a center has ever governed this student.
   *
   * True while they are in a center, and still true after one released them:
   * `students.center_id` is SET NULL on release while `students.tier` is not,
   * so a leftover tier is evidence that a center once governed them. It is
   * evidence ONLY — `tier` above stays null for anyone no center governs, so
   * nothing grants access on the strength of a stale value.
   *
   * It separates a genuine independent student, who predates the center model
   * and keeps what they have, from one a center released — which is otherwise
   * a way for a center to hand its students a paid tier for free.
   */
  wasGoverned: boolean;
  /**
   * Why this student may not learn, in the words the app turns into a
   * sentence — or null when they may (D19).
   *
   * `NO_CODE` for an account that never redeemed one, `CODE_DEACTIVATED` when
   * a school took theirs back, `CODE_EXPIRED` when it ran out, `CENTER_UNPAID`
   * when their school's subscription lapsed. It is for wording only; whether
   * they may learn is `studentsMayLearn`.
   */
  accessRefusal: AccessRefusal | null;
}

export type AccessRefusal =
  | 'NO_CODE'
  | 'CODE_DEACTIVATED'
  | 'CODE_EXPIRED'
  | 'CENTER_UNPAID';

/**
 * A token naming no student row: a guest.
 *
 * `/api/auth/guest` mints an id and writes nothing. Whether guests may learn at
 * all is still undecided (B16), so until then they keep what they have today.
 */
const guest = (): StudentEntitlement => ({
  status: 'NONE',
  studentsMayLearn: true,
  graceEndsAt: null,
  tier: null,
  studentExists: false,
  wasGoverned: false,
  accessRefusal: null,
});

/** One row per student, or none at all if the student is gone. */
interface EntitlementRow {
  center_id: string | null;
  plan: CenterSubscriptionRecord['plan'] | null;
  trial_started_at: Date | null;
  trial_ends_at: Date | null;
  paid_until: Date | null;
  tier: Tier | null;
  /** Set by the migration that required codes, on the users of that day. */
  grandfathered_access?: boolean | null;
  /** The student's most recent code, only for saying WHY access is refused. */
  last_code_status?: string | null;
  last_code_expires_at?: Date | null;
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
    // The last-code columns are scalar subqueries rather than a join, so this
    // stays ONE statement, and they are only read to word a refusal. On the
    // happy path they cost nothing a round trip would notice.
    const rows = await this.prisma.$queryRaw<EntitlementRow[]>`
      SELECT s.center_id,
             cs.plan::text AS plan,
             cs.trial_started_at,
             cs.trial_ends_at,
             cs.paid_until,
             s.tier::text AS tier,
             s.grandfathered_access,
             (SELECT ac.status::text FROM activation_codes ac
               WHERE ac.student_id = s.id
               ORDER BY ac.updated_at DESC LIMIT 1) AS last_code_status,
             (SELECT ac.expires_at FROM activation_codes ac
               WHERE ac.student_id = s.id
               ORDER BY ac.updated_at DESC LIMIT 1) AS last_code_expires_at
        FROM students s
        LEFT JOIN center_subscriptions cs ON cs.center_id = s.center_id
       WHERE s.id = ${studentId}
    `;

    const row = rows[0];

    // No row at all. A guest token, or an id that never existed: nothing can
    // be attributed to it, and nothing ever governed it.
    if (!row) {
      return guest();
    }

    // A row, but no center. Either a genuine independent student or one a
    // center released — the leftover tier is what tells them apart.
    if (!row.center_id) {
      // Truthiness rather than `!== null`: a missing column reads as
      // undefined, and treating that as "holds a tier" would mark a genuine
      // independent student as formerly governed and take the exam module
      // away from them.
      const wasGoverned = Boolean(row.tier);

      // An account alone is not access (D9) — except for the people already
      // using the app on their own when that rule shipped (D34). The mark is
      // honoured only without a tier: a school once governed anyone who has
      // one, and releasing them must not restore free access.
      const mayLearn = Boolean(row.grandfathered_access) && !wasGoverned;

      return {
        status: 'NONE',
        studentsMayLearn: mayLearn,
        graceEndsAt: null,
        tier: null,
        studentExists: true,
        wasGoverned,
        accessRefusal: mayLearn ? null : this.refusalFromLastCode(row),
      };
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
        studentExists: true,
        wasGoverned: true,
        accessRefusal: 'CENTER_UNPAID',
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
      studentExists: true,
      wasGoverned: true,
      // A governed student is refused only because their school is not
      // entitled — a trial that ended, a payment that lapsed. Their code ends
      // with the trial, so this is the reason even then.
      accessRefusal: decision.studentsMayLearn ? null : 'CENTER_UNPAID',
    };
  }

  /**
   * Why a student with no school may not learn, read from their latest code.
   *
   * Only wording: the decision was already made. A student whose code a school
   * took back hears that, one whose code ran out hears that, and anyone else
   * is asked for a code.
   */
  private refusalFromLastCode(row: EntitlementRow): AccessRefusal {
    if (row.last_code_status === 'DEACTIVATED') {
      return 'CODE_DEACTIVATED';
    }

    if (row.last_code_expires_at && row.last_code_expires_at <= new Date()) {
      return 'CODE_EXPIRED';
    }

    return 'NO_CODE';
  }
}
