import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import type { CenterUser } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../shared/services/prisma.service';
import { EmailService } from '../auth/email.service';
import { TokenCryptoService } from '../auth/token-crypto.service';

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
/** Seats a center starts with. The trial clock itself starts at the first
 *  student activation, not here. */
/**
 * One seat, granted at registration.
 *
 * Dropped from three on the founder's call: three seats let a school run a
 * small class for free and postpone the decision, while one is enough to see
 * what the product does. A second student is refused with SEAT_LIMIT_REACHED,
 * which is the moment to sell.
 *
 * It is also comfortably below the ten-seat paid minimum, so converting never
 * trips the student floor.
 */
const TRIAL_SEATS = 1;

/**
 * What a trial seat is, in data: an ordinary Start seat priced at zero.
 *
 * Not a special case, deliberately — see the seat row created in `register`.
 */
const TRIAL_SEAT_TIER = 'START' as const;
const TRIAL_SEAT_PRICE_XAF = 0;
const VERIFICATION_RESEND_COOLDOWN_MS = 2 * 60 * 1000;
const REGISTRATION_RESPONSE = { message: 'verification email sent' } as const;

/**
 * Five fields. Country, city, the manager's phone and the logo are collected
 * during onboarding instead, at the point the center goes to pay — none is
 * needed to run a trial, and all are needed to take money.
 */
export interface RegisterCenterInput {
  centerName: string;
  managerFirstName: string;
  managerLastName: string;
  email: string;
  password: string;
}

type ExistingCenterUser = Pick<
  CenterUser,
  'id' | 'email_verified' | 'email_verification_expires'
>;

@Injectable()
export class CentersService {
  private readonly logger = new Logger(CentersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenCrypto: TokenCryptoService,
    private readonly emailService: EmailService,
  ) {}

  async register(
    input: RegisterCenterInput,
  ): Promise<{ message: 'verification email sent' }> {
    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.centerUser.findUnique({
      where: { email },
      select: {
        id: true,
        email_verified: true,
        email_verification_expires: true,
      },
    });

    if (existing?.email_verified) {
      return REGISTRATION_RESPONSE;
    }

    if (existing) {
      return this.handleExistingUnverifiedUser(existing, email);
    }

    return this.createCenterAndOwner(input, email);
  }

  private async handleExistingUnverifiedUser(
    existing: ExistingCenterUser,
    email: string,
  ): Promise<{ message: 'verification email sent' }> {
    // expiresAt = sentAt + TTL, so this threshold is equivalent to
    // sentAt = now - cooldown. It is also reused by the atomic update below.
    const resendThreshold = new Date(
      Date.now() + VERIFICATION_TOKEN_TTL_MS - VERIFICATION_RESEND_COOLDOWN_MS,
    );

    if (
      existing.email_verification_expires &&
      existing.email_verification_expires > resendThreshold
    ) {
      return REGISTRATION_RESPONSE;
    }

    const rawToken = this.tokenCrypto.generateToken();
    const tokenHash = this.tokenCrypto.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);

    // The expiry predicate makes rotation atomic. If two requests race, the
    // first update installs a fresh expiry and the second update affects zero
    // rows, so only one usable link is sent.
    const result = await this.prisma.centerUser.updateMany({
      where: {
        id: existing.id,
        email_verified: false,
        OR: [
          { email_verification_expires: null },
          { email_verification_expires: { lte: resendThreshold } },
        ],
      },
      data: {
        email_verification_token: tokenHash,
        email_verification_expires: expiresAt,
      },
    });

    if (result.count === 0) {
      return REGISTRATION_RESPONSE;
    }

    try {
      await this.emailService.sendExistingCenterVerificationEmail(
        email,
        rawToken,
      );
    } catch {
      await this.clearFailedVerificationToken(existing.id, tokenHash);
      throw new BadGatewayException('EMAIL_DELIVERY_FAILED');
    }

    return REGISTRATION_RESPONSE;
  }

  private async createCenterAndOwner(
    input: RegisterCenterInput,
    email: string,
  ): Promise<{ message: 'verification email sent' }> {
    const rawToken = this.tokenCrypto.generateToken();
    const tokenHash = this.tokenCrypto.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);
    const passwordHash = await bcrypt.hash(input.password, 12);

    try {
      const centerUserId = await this.prisma.$transaction(async (tx) => {
        // A draft center: its name and nothing else. Country, city and the
        // logo arrive during onboarding, so they are left null here rather
        // than filled with placeholders that would look like real answers.
        const center = await tx.center.create({
          data: { name: input.centerName.trim() },
          select: { id: true },
        });

        const centerUser = await tx.centerUser.create({
          data: {
            center_id: center.id,
            role: 'OWNER',
            first_name: input.managerFirstName.trim(),
            last_name: input.managerLastName.trim(),
            email,
            password_hash: passwordHash,
            email_verified: false,
            email_verification_token: tokenHash,
            email_verification_expires: expiresAt,
          },
          select: { id: true },
        });

        // Third insert in the same transaction: every center provably has
        // exactly one subscription, so nothing downstream needs a
        // missing-row branch. A failed registration leaves neither behind.
        await tx.centerSubscription.create({
          data: { center_id: center.id, plan: 'TRIAL' },
        });

        // Fourth insert, same transaction: the trial seat itself. A trial is
        // an ordinary seat row priced at zero rather than a flag, so seat
        // counting, tier lookup and the quota check need no "unless they are
        // on trial" branch. A trial student and a paid Start student then
        // differ only in the clock.
        //
        // Zero is legal here and illegal on a payment line, which is what
        // keeps a granted seat and a bought seat from being confused.
        await tx.centerSeat.create({
          data: {
            center_id: center.id,
            tier: TRIAL_SEAT_TIER,
            quantity: TRIAL_SEATS,
            unit_price_xaf: TRIAL_SEAT_PRICE_XAF,
          },
        });

        return centerUser.id;
      });

      // Delivery stays outside the transaction so provider latency or failure
      // cannot hold database locks or roll back the created identity.
      try {
        await this.emailService.sendCenterVerificationEmail(email, rawToken);
      } catch {
        await this.clearFailedVerificationToken(centerUserId, tokenHash);
        throw new BadGatewayException('EMAIL_DELIVERY_FAILED');
      }
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        return REGISTRATION_RESPONSE;
      }
      throw error;
    }

    return REGISTRATION_RESPONSE;
  }

  private async clearFailedVerificationToken(
    centerUserId: string,
    tokenHash: string,
  ): Promise<void> {
    try {
      await this.prisma.centerUser.updateMany({
        where: {
          id: centerUserId,
          email_verified: false,
          email_verification_token: tokenHash,
        },
        data: {
          email_verification_token: null,
          email_verification_expires: null,
        },
      });
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.error(
        `Failed to clear a center verification token after email delivery failure (${errorName})`,
      );
    }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}
