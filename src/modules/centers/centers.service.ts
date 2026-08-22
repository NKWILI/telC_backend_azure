import { BadGatewayException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../shared/services/prisma.service';
import { EmailService } from '../auth/email.service';
import { TokenCryptoService } from '../auth/token-crypto.service';

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const VERIFICATION_RESEND_COOLDOWN_MS = 2 * 60 * 1000;
const REGISTRATION_RESPONSE = { message: 'verification email sent' } as const;

export interface RegisterCenterInput {
  centerName: string;
  country: string;
  city: string;
  logoUrl?: string;
  managerFirstName: string;
  managerLastName: string;
  email: string;
  phone: string;
  password: string;
}

type ExistingCenterUser = {
  id: string;
  email_verified: boolean;
  email_verification_expires: Date | null;
};

@Injectable()
export class CentersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenCrypto: TokenCryptoService,
    private readonly emailService: EmailService,
  ) {}

  async register(
    input: RegisterCenterInput,
  ): Promise<{ message: 'verification email sent' }> {
    const email = input.email.trim().toLowerCase();
    const existing = (await this.prisma.centerUser.findUnique({
      where: { email },
      select: {
        id: true,
        email_verified: true,
        email_verification_expires: true,
      },
    })) as ExistingCenterUser | null;

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
      await this.prisma.$transaction(async (tx) => {
        const center = await tx.center.create({
          data: {
            name: input.centerName.trim(),
            country: input.country.trim(),
            city: input.city.trim(),
            logo_url: input.logoUrl?.trim() || null,
          },
          select: { id: true },
        });

        await tx.centerUser.create({
          data: {
            center_id: center.id,
            role: 'OWNER',
            first_name: input.managerFirstName.trim(),
            last_name: input.managerLastName.trim(),
            email,
            phone: input.phone.trim(),
            password_hash: passwordHash,
            email_verified: false,
            email_verification_token: tokenHash,
            email_verification_expires: expiresAt,
          },
        });
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        return REGISTRATION_RESPONSE;
      }
      throw error;
    }

    // Delivery is deliberately outside the transaction: a slow or unavailable
    // email provider must never hold locks or roll back the created identity.
    try {
      await this.emailService.sendCenterVerificationEmail(email, rawToken);
    } catch {
      throw new BadGatewayException('EMAIL_DELIVERY_FAILED');
    }

    return REGISTRATION_RESPONSE;
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
