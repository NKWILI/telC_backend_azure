import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CenterAccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { PrismaService } from '../../shared/services/prisma.service';
import { TokenCryptoService } from '../auth/token-crypto.service';
import { ACTIVATION_KEY_TTL_DAYS } from './student-provisioning.service';

const DAY_MS = 24 * 60 * 60 * 1000;

type SignedCenterIdentity = Pick<CenterAccessTokenPayload, 'centerId'>;

export interface ListStudentsQuery {
  page: number;
  pageSize: number;
}

export interface UpdateStudentInput {
  firstName?: string;
  lastName?: string;
  phone?: string;
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
}

@Injectable()
export class CenterStudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenCrypto: TokenCryptoService,
  ) {}

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
    };

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('NO_STUDENT_FIELDS_SUPPLIED');
    }

    await this.loadOwned(identity, studentId);
    await this.prisma.student.update({ where: { id: studentId }, data });

    return this.toView(await this.loadOwned(identity, studentId));
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
    identity: SignedCenterIdentity,
    studentId: string,
  ): Promise<{ removed: true }> {
    const result = await this.prisma.student.updateMany({
      where: { id: studentId, center_id: identity.centerId },
      data: { center_id: null },
    });

    if (result.count !== 1) {
      throw new NotFoundException('STUDENT_NOT_FOUND');
    }

    return { removed: true };
  }

  /**
   * Mints a fresh key, replacing any outstanding one — for a student who lost
   * the paper, or whose key expired.
   *
   * The `activated_at: null` predicate is the important part: a center must not
   * be able to re-key an account that is already in use, because redeeming that
   * key would set a new password and take the account from its owner.
   */
  async issueActivationKey(
    identity: SignedCenterIdentity,
    studentId: string,
  ): Promise<{ activationKey: string; activationKeyExpiresAt: Date }> {
    const rawKey = this.tokenCrypto.generateToken();
    const activationKeyExpiresAt = new Date(
      Date.now() + ACTIVATION_KEY_TTL_DAYS * DAY_MS,
    );

    const result = await this.prisma.student.updateMany({
      where: {
        id: studentId,
        center_id: identity.centerId,
        activated_at: null,
      },
      data: {
        activation_key_hash: this.tokenCrypto.hashToken(rawKey),
        activation_key_expires: activationKeyExpiresAt,
      },
    });

    if (result.count !== 1) {
      throw new NotFoundException('STUDENT_NOT_FOUND_OR_ALREADY_ACTIVE');
    }

    return { activationKey: rawKey, activationKeyExpiresAt };
  }

  async revokeActivationKey(
    identity: SignedCenterIdentity,
    studentId: string,
  ): Promise<{ revoked: true }> {
    const result = await this.prisma.student.updateMany({
      where: {
        id: studentId,
        center_id: identity.centerId,
        activated_at: null,
      },
      data: { activation_key_hash: null, activation_key_expires: null },
    });

    if (result.count !== 1) {
      throw new NotFoundException('STUDENT_NOT_FOUND_OR_ALREADY_ACTIVE');
    }

    return { revoked: true };
  }

  /**
   * 404 rather than 403 for a student outside this center. A 403 would confirm
   * the id exists somewhere, which is exactly the probe a center could use to
   * enumerate another school's roster.
   */
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
    };
  }
}
