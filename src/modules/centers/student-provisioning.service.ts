import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Tier } from '@prisma/client';
import type { CenterAccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { PrismaService } from '../../shared/services/prisma.service';
import { EmailService } from '../auth/email.service';
import { TokenCryptoService } from '../auth/token-crypto.service';

/** How long a center has to get the key into a student's hands. */
export const ACTIVATION_KEY_TTL_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

type SignedCenterIdentity = Pick<CenterAccessTokenPayload, 'centerId'>;

export interface ProvisionStudentInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  /**
   * Which tier's seat this student takes, chosen by the center.
   *
   * Required rather than defaulted. A center holding several tiers has no
   * obvious default, and guessing the cheapest would quietly put a student the
   * school meant to give the exam module into a tier without it.
   */
  tier: Tier;
}

export interface ProvisionedStudent {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  /** Shown once. Only its hash is stored, so it cannot be recovered later. */
  activationKey: string;
  activationKeyExpiresAt: Date;
}

@Injectable()
export class StudentProvisioningService {
  private readonly logger = new Logger(StudentProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenCrypto: TokenCryptoService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Creates a student inside the signed center and mints their first
   * activation key.
   *
   * The seat check and the insert share one Serializable transaction. Counting
   * outside it would let two administrators both read the second-to-last seat
   * and both insert, putting the center over its limit with no way to notice.
   *
   * The check is per tier, because a seat belongs to a tier: a Start student
   * cannot sit in a Pro seat.
   */
  async provision(
    identity: SignedCenterIdentity,
    input: ProvisionStudentInput,
  ): Promise<ProvisionedStudent> {
    const email = input.email?.trim().toLowerCase();
    if (!email) {
      throw new BadRequestException('STUDENT_EMAIL_REQUIRED');
    }

    const rawKey = this.tokenCrypto.generateToken();
    const activationKeyExpiresAt = new Date(
      Date.now() + ACTIVATION_KEY_TTL_DAYS * DAY_MS,
    );

    const student = await this.prisma.$transaction(
      async (tx) => {
        const subscription = await tx.centerSubscription.findUnique({
          where: { center_id: identity.centerId },
          select: { seats: true },
        });
        if (!subscription) {
          throw new NotFoundException('CENTER_SUBSCRIPTION_NOT_FOUND');
        }

        // The seats of the requested tier, and nothing else. A missing row is
        // not an empty one: a center that has never bought Premium is told to
        // buy it, while a center whose Premium seats are full is told to wait
        // or buy more. Those ask for different actions, so they get different
        // codes.
        const seat = await tx.centerSeat.findUnique({
          where: {
            center_id_tier: {
              center_id: identity.centerId,
              tier: input.tier,
            },
          },
          select: { quantity: true },
        });
        if (!seat) {
          throw new ForbiddenException({
            message: 'TIER_NOT_HELD',
            tier: input.tier,
          });
        }

        // Counted within the tier. Counting the whole center would let a
        // center with its Start seats full and a spare Pro seat add another
        // Start student, entitled to Start's allowance in a seat nobody bought
        // at that tier.
        const seatsUsed = await tx.student.count({
          where: { center_id: identity.centerId, tier: input.tier },
        });
        if (seatsUsed >= seat.quantity) {
          // Named, because "no seats left" is useless to a center holding
          // three tiers and short in only one of them.
          throw new ForbiddenException({
            message: 'SEAT_LIMIT_REACHED',
            tier: input.tier,
          });
        }

        // Refuse rather than attach. Attaching would hand this center control
        // of a stranger's existing account and their whole learning history,
        // without that person ever agreeing to it.
        const existing = await tx.student.findUnique({
          where: { email },
          select: { id: true },
        });
        if (existing) {
          throw new ConflictException('STUDENT_EMAIL_ALREADY_EXISTS');
        }

        return tx.student.create({
          data: {
            center_id: identity.centerId,
            first_name: input.firstName.trim(),
            last_name: input.lastName.trim(),
            email,
            phone: input.phone?.trim() || null,
            tier: input.tier,
            // The center vouched for the address, so reset stays available
            // without a second confirmation step the student never asked for.
            email_verified: true,
            // No credential until the student redeems their key. A null hash
            // is also what makes login refuse this account in the meantime.
            password_hash: null,
            activation_key_hash: this.tokenCrypto.hashToken(rawKey),
            activation_key_expires: activationKeyExpiresAt,
            activated_at: null,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // After the commit, and never fatal. The email proves the address works
    // and surfaces a typo to the center as a bounce; it is not worth undoing a
    // provision that already succeeded.
    try {
      await this.emailService.sendStudentWelcomeEmail(
        email,
        input.firstName.trim(),
      );
    } catch (error) {
      this.logger.warn(
        `Student welcome email failed (${error instanceof Error ? error.name : 'UnknownError'})`,
      );
    }

    return {
      id: student.id,
      firstName: student.first_name,
      lastName: student.last_name,
      email: student.email,
      activationKey: rawKey,
      activationKeyExpiresAt,
    };
  }
}
