import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivationCodeStatus, Prisma, type Tier } from '@prisma/client';
import type { CenterAccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { PrismaService } from '../../shared/services/prisma.service';

type SignedCenterIdentity = Pick<CenterAccessTokenPayload, 'centerId'>;

export interface ListStudentsQuery {
  page: number;
  pageSize: number;
}

export interface UpdateStudentInput {
  firstName?: string;
  lastName?: string;
  phone?: string;
  /**
   * Move this student into another tier.
   *
   * Allowed only when the center holds a free seat there. No pro-rating: the
   * move takes effect immediately for access and the price difference settles
   * at the next renewal.
   */
  tier?: Tier;
}

export interface CenterStudentView {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  /** Whether they redeemed their key and set a password. */
  activated: boolean;
  activatedAt: Date | null;
  activationKeyExpiresAt: Date | null;
  createdAt: Date;
  lastSeenAt: Date;
  /**
   * Which tier's seat they occupy, and therefore what they may do. Null for a
   * student provisioned before tiers existed.
   */
  tier: Tier | null;
}

@Injectable()
export class CenterStudentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    identity: SignedCenterIdentity,
    query: ListStudentsQuery,
  ): Promise<{
    students: CenterStudentView[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const where = { center_id: identity.centerId };

    const [rows, total] = await Promise.all([
      this.prisma.student.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.student.count({ where }),
    ]);

    return {
      students: rows.map((row) => this.toView(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(
    identity: SignedCenterIdentity,
    studentId: string,
  ): Promise<CenterStudentView> {
    return this.toView(await this.loadOwned(identity, studentId));
  }

  /**
   * Edits a student, and moves them between tiers.
   *
   * A tier move is the most common thing a school does after buying: a Start
   * student decides to sit the exam and needs Pro. The alternative was
   * remove-and-re-add, which works but invites mistakes on an account holding
   * the student's whole history.
   *
   * The whole update runs in one Serializable transaction because a tier move
   * consumes a seat. Two administrators moving two students into the last free
   * Pro seat would otherwise both read it free and both write, putting the
   * tier over its quantity with nothing to notice.
   */
  async update(
    identity: SignedCenterIdentity,
    studentId: string,
    changes: UpdateStudentInput,
  ): Promise<CenterStudentView> {
    const data = {
      ...(changes.firstName !== undefined && {
        first_name: changes.firstName,
      }),
      ...(changes.lastName !== undefined && { last_name: changes.lastName }),
      ...(changes.phone !== undefined && { phone: changes.phone }),
      ...(changes.tier !== undefined && { tier: changes.tier }),
    };

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('NO_STUDENT_FIELDS_SUPPLIED');
    }

    const updated = await this.prisma.$transaction(
      async (tx) => {
        // Ownership first, so another center's student is a 404 before any
        // seat is inspected — the seat answer would otherwise confirm the id.
        const student = await tx.student.findFirst({
          where: { id: studentId, center_id: identity.centerId },
        });

        if (!student) {
          throw new NotFoundException('STUDENT_NOT_FOUND');
        }

        if (changes.tier !== undefined) {
          await this.assertSeatFreeInTier(
            tx,
            identity.centerId,
            changes.tier,
            studentId,
          );
        }

        return tx.student.update({ where: { id: studentId }, data });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return this.toView(updated);
  }

  /**
   * Whether this center may put one more student into a tier.
   *
   * The student being moved is excluded from the count. Without that, a
   * student already in Pro could never be sent to Pro again — a client
   * re-sending the value it already holds would be refused on a tier that is
   * exactly full, which looks like a bug to everyone involved.
   *
   * A missing seat row and a full one stay distinct, as in provisioning: one
   * is fixed by buying the tier, the other by buying more seats.
   */
  private async assertSeatFreeInTier(
    tx: Pick<PrismaService, 'centerSeat' | 'student'>,
    centerId: string,
    tier: Tier,
    movingStudentId: string,
  ): Promise<void> {
    const seat = await tx.centerSeat.findUnique({
      where: { center_id_tier: { center_id: centerId, tier } },
      select: { quantity: true },
    });

    if (!seat) {
      throw new ForbiddenException({ message: 'TIER_NOT_HELD', tier });
    }

    const seatsUsed = await tx.student.count({
      where: { center_id: centerId, tier, id: { not: movingStudentId } },
    });

    if (seatsUsed >= seat.quantity) {
      throw new ForbiddenException({ message: 'SEAT_LIMIT_REACHED', tier });
    }
  }

  /**
   * Releases the seat by unlinking, never by deleting.
   *
   * The account, the password the student chose, and every attempt they ever
   * submitted survive. Deleting would destroy a person's work because an
   * administrator edited a roster, and would discard exactly the former
   * student that `ARCHITECTURE-B2B2C.md` describes as worth keeping in touch
   * with. It also matches `Student.center_id` already being ON DELETE SET NULL.
   */
  async remove(
    // The manager too, not just the center: releasing a code is recorded
    // against whoever did it.
    identity: Pick<CenterAccessTokenPayload, 'centerId' | 'centerUserId'>,
    studentId: string,
  ): Promise<{ removed: true }> {
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.student.updateMany({
        where: { id: studentId, center_id: identity.centerId },
        data: { center_id: null },
      });

      if (result.count !== 1) {
        throw new NotFoundException('STUDENT_NOT_FOUND');
      }

      // The code this student redeemed here is released with them. Left
      // connected, it would keep counting as a used seat, and — since a
      // student may hold one connected code — stop them redeeming a code at
      // any other school. Same transaction, so a roster edit can never leave
      // the two disagreeing.
      const held = await tx.activationCode.findMany({
        where: {
          student_id: studentId,
          center_id: identity.centerId,
          status: ActivationCodeStatus.CONNECTED,
        },
        select: { id: true },
      });

      for (const code of held) {
        const released = await tx.activationCode.updateMany({
          where: { id: code.id, status: ActivationCodeStatus.CONNECTED },
          data: { status: ActivationCodeStatus.DEACTIVATED },
        });

        if (released.count === 1) {
          await tx.activationCodeEvent.create({
            data: {
              code_id: code.id,
              center_id: identity.centerId,
              center_user_id: identity.centerUserId,
              from_status: ActivationCodeStatus.CONNECTED,
              to_status: ActivationCodeStatus.DEACTIVATED,
              student_id: studentId,
            },
          });
        }
      }
    });

    return { removed: true };
  }

  private async loadOwned(identity: SignedCenterIdentity, studentId: string) {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, center_id: identity.centerId },
    });

    if (!student) {
      throw new NotFoundException('STUDENT_NOT_FOUND');
    }

    return student;
  }

  /**
   * Built field by field rather than by spreading the row. The student table
   * carries a password hash, an activation key hash and reset tokens, and a
   * spread would put every one of them in an API response the moment someone
   * added a column.
   */
  private toView(row: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    activated_at: Date | null;
    activation_key_expires: Date | null;
    created_at: Date;
    last_seen_at: Date;
    tier: Tier | null;
  }): CenterStudentView {
    return {
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      phone: row.phone,
      activated: row.activated_at !== null,
      activatedAt: row.activated_at,
      activationKeyExpiresAt: row.activation_key_expires,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      tier: row.tier,
    };
  }
}
