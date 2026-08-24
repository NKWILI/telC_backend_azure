import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../shared/services/prisma.service';
import {
  StudentEntitlementService,
  type StudentEntitlement,
} from '../../shared/services/student-entitlement.service';
import { AuthService } from '../auth/auth.service';
import { TokenCryptoService } from '../auth/token-crypto.service';

/** Matches the trial length in the product rules. */
export const TRIAL_DURATION_DAYS = 30;
/** Matches the student registration policy, so activation is not a weaker door. */
export const MIN_STUDENT_PASSWORD_LENGTH = 8;
/** Matches `AuthService.register`, so activated and registered accounts hash alike. */
const STUDENT_BCRYPT_COST = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ActivateStudentInput {
  key: string;
  password: string;
  deviceId: string;
  deviceName?: string;
  /** Recorded on the student, so a center redeeming its own key leaves a trace. */
  ip?: string;
}

@Injectable()
export class StudentActivationService {
  private readonly logger = new Logger(StudentActivationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenCrypto: TokenCryptoService,
    private readonly authService: AuthService,
    private readonly entitlementService: StudentEntitlementService,
  ) {}

  /**
   * Redeems an activation key: the student sets their own password, the key is
   * consumed, and the owning center's trial starts if it has not already.
   *
   * The pre-reads exist only to separate "expired" from "unknown" for the
   * caller. The predicated update inside the transaction is the actual gate.
   */
  async activate(input: ActivateStudentInput): Promise<{
    accessToken: string;
    refreshToken: string;
    subscription?: StudentEntitlement;
  }> {
    if (
      !input.password ||
      input.password.length < MIN_STUDENT_PASSWORD_LENGTH
    ) {
      throw new BadRequestException('PASSWORD_TOO_SHORT');
    }

    const rawKey = input.key?.trim();
    if (!rawKey) {
      throw new BadRequestException('ACTIVATION_KEY_INVALID');
    }

    const keyHash = this.tokenCrypto.hashToken(rawKey);
    const student = await this.prisma.student.findFirst({
      where: { activation_key_hash: keyHash },
    });

    if (!student || student.activated_at) {
      throw new BadRequestException('ACTIVATION_KEY_INVALID');
    }

    const now = new Date();
    if (
      !student.activation_key_expires ||
      student.activation_key_expires <= now
    ) {
      // Distinct from INVALID so a center can tell a stale key from a wrong
      // one and simply re-issue. The student-facing message stays generic.
      throw new BadRequestException('ACTIVATION_KEY_EXPIRED');
    }

    const passwordHash = await bcrypt.hash(input.password, STUDENT_BCRYPT_COST);

    await this.prisma.$transaction(async (tx) => {
      // The predicate is the single-use gate. A replay, or a second request
      // racing this one, matches zero rows and is rejected.
      const consumed = await tx.student.updateMany({
        where: {
          id: student.id,
          activation_key_hash: keyHash,
          activated_at: null,
        },
        data: {
          password_hash: passwordHash,
          activation_key_hash: null,
          activation_key_expires: null,
          activated_at: now,
          activated_ip: input.ip ?? null,
        },
      });

      if (consumed.count !== 1) {
        throw new BadRequestException('ACTIVATION_KEY_INVALID');
      }

      // Same transaction as the consume, deliberately. Split apart, a key
      // could be spent while the trial failed to start, leaving a center that
      // can never be billed for a student who is already learning.
      if (student.center_id) {
        await tx.centerSubscription.updateMany({
          where: {
            center_id: student.center_id,
            // Once set, this matches nothing: a second student cannot restart
            // the clock, and the first activation is the only one that counts.
            trial_started_at: null,
          },
          data: {
            trial_started_at: now,
            trial_ends_at: new Date(
              now.getTime() + TRIAL_DURATION_DAYS * DAY_MS,
            ),
          },
        });
      }
    });

    // From here the student is an ordinary Lerniqo user who happens to belong
    // to a center, and gets the same session shape as any other.
    const tokens = await this.authService.issueSessionForStudent(
      student.id,
      input.deviceId,
      input.deviceName,
    );

    // Read after the transaction, deliberately. Before it, the center is still
    // TRIAL_PENDING — the state this very request has just ended — and the
    // client would be handed the answer to the previous question.
    const subscription = await this.readEntitlement(student.id);

    return { ...tokens, ...(subscription ? { subscription } : {}) };
  }

  /**
   * Reporting only, and never fatal.
   *
   * By the time this runs the key is spent and the password is set. Throwing
   * would hand back a failure for an activation that actually succeeded, and
   * the student would retry with a key that no longer works.
   */
  private async readEntitlement(
    studentId: string,
  ): Promise<StudentEntitlement | undefined> {
    try {
      return await this.entitlementService.forStudent(studentId);
    } catch (error) {
      this.logger.warn(
        `activation: could not read entitlement for ${studentId}: ${(error as Error).message}`,
      );
      return undefined;
    }
  }
}
