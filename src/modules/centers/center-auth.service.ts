import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, type CenterUser } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../shared/services/prisma.service';
import { ValkeyService } from '../../shared/services/valkey.service';
import { TokenCryptoService } from '../auth/token-crypto.service';
import { TokenService } from '../auth/token.service';
import { CenterAuthResponseDto } from './dto/center-auth-response.dto';

const MAX_ACTIVE_CENTER_DEVICES = 3;
const SESSION_TRANSACTION_ATTEMPTS = 2;
const DUMMY_PASSWORD_HASH =
  '$2b$12$qFTZukjWcXnvTRaxRPtsaOilBLN4JeORTxRVuk6G8jLxqChc.UQSm';

type CenterUserWithCenter = Prisma.CenterUserGetPayload<{
  include: { center: true };
}>;

export interface VerifyCenterEmailInput {
  token: string;
  deviceId: string;
  deviceName?: string;
}

export interface CenterLoginInput {
  email: string;
  password: string;
  deviceId: string;
  deviceName?: string;
}

interface SessionIssueResult {
  accessToken: string;
  refreshToken: string;
  evictedSessionId: string | null;
}

@Injectable()
export class CenterAuthService {
  private readonly logger = new Logger(CenterAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly tokenCrypto: TokenCryptoService,
    @Optional() private readonly valkeyService?: ValkeyService,
  ) {}

  async verifyEmail(
    input: VerifyCenterEmailInput,
  ): Promise<CenterAuthResponseDto> {
    const deviceId = this.normalizeDeviceId(input.deviceId);
    const rawToken = input.token?.trim();
    if (!rawToken) {
      throw new BadRequestException('VERIFICATION_TOKEN_INVALID');
    }

    const tokenHash = this.tokenCrypto.hashToken(rawToken);
    const centerUser = await this.prisma.centerUser.findFirst({
      where: { email_verification_token: tokenHash },
      include: { center: true },
    });

    if (!centerUser || centerUser.email_verified) {
      throw new BadRequestException('VERIFICATION_TOKEN_INVALID');
    }

    const now = new Date();
    if (
      !centerUser.email_verification_expires ||
      centerUser.email_verification_expires <= now
    ) {
      throw new BadRequestException('VERIFICATION_TOKEN_EXPIRED');
    }

    const consumed = await this.prisma.centerUser.updateMany({
      where: {
        id: centerUser.id,
        email_verified: false,
        email_verification_token: tokenHash,
        email_verification_expires: { gt: now },
      },
      data: {
        email_verified: true,
        email_verification_token: null,
        email_verification_expires: null,
      },
    });

    if (consumed.count !== 1) {
      throw new BadRequestException('VERIFICATION_TOKEN_INVALID');
    }

    return this.issueAuthResponse(
      { ...centerUser, email_verified: true },
      deviceId,
      input.deviceName,
    );
  }

  async login(input: CenterLoginInput): Promise<CenterAuthResponseDto> {
    const deviceId = this.normalizeDeviceId(input.deviceId);
    const email = input.email.trim().toLowerCase();
    const centerUser = await this.prisma.centerUser.findUnique({
      where: { email },
      include: { center: true },
    });

    const passwordMatches = await bcrypt.compare(
      input.password,
      centerUser?.password_hash ?? DUMMY_PASSWORD_HASH,
    );
    if (!centerUser || !passwordMatches) {
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }

    if (!centerUser.email_verified) {
      throw new ForbiddenException('EMAIL_NOT_VERIFIED');
    }

    return this.issueAuthResponse(centerUser, deviceId, input.deviceName);
  }

  async rotateDeviceSessionRefreshHash(
    centerUserId: string,
    sessionId: string,
    expectedRefreshTokenHash: string,
    newRefreshTokenHash: string,
  ): Promise<boolean> {
    const result = await this.prisma.centerDeviceSession.updateMany({
      where: {
        id: sessionId,
        center_user_id: centerUserId,
        refresh_token_hash: expectedRefreshTokenHash,
        revoked_at: null,
      },
      data: {
        refresh_token_hash: newRefreshTokenHash,
        last_used_at: new Date(),
      },
    });

    return result.count === 1;
  }

  async revokeDeviceSession(
    centerUserId: string,
    sessionId: string,
  ): Promise<void> {
    const result = await this.prisma.centerDeviceSession.updateMany({
      where: {
        id: sessionId,
        center_user_id: centerUserId,
        revoked_at: null,
      },
      data: { revoked_at: new Date() },
    });

    if (result.count !== 1) {
      throw new UnauthorizedException('INVALID_SESSION');
    }

    await this.revokeCachedSession(sessionId);
  }

  private async issueAuthResponse(
    centerUser: CenterUserWithCenter,
    deviceId: string,
    deviceName?: string,
  ): Promise<CenterAuthResponseDto> {
    const tokens = await this.issueSessionTokens(
      centerUser,
      deviceId,
      deviceName,
    );
    await this.updateCenterLastSeen(centerUser.id);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      centerUser: {
        id: centerUser.id,
        role: centerUser.role,
        firstName: centerUser.first_name,
        lastName: centerUser.last_name,
        email: centerUser.email,
        phone: centerUser.phone,
        emailVerified: centerUser.email_verified,
      },
      center: {
        id: centerUser.center.id,
        name: centerUser.center.name,
        country: centerUser.center.country,
        city: centerUser.center.city,
        logoUrl: centerUser.center.logo_url,
      },
    };
  }

  private async issueSessionTokens(
    centerUser: CenterUserWithCenter,
    deviceId: string,
    deviceName?: string,
  ): Promise<SessionIssueResult> {
    let lastConflict: unknown;

    for (let attempt = 0; attempt < SESSION_TRANSACTION_ATTEMPTS; attempt++) {
      try {
        const transactionResult = await this.prisma.$transaction(
          (tx) =>
            this.issueSessionTokensInTransaction(
              tx,
              centerUser,
              deviceId,
              deviceName,
            ),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );

        if (transactionResult.evictedSessionId) {
          await this.revokeCachedSession(transactionResult.evictedSessionId);
        }
        return transactionResult;
      } catch (error) {
        if (!this.isRetryableSessionConflict(error)) {
          this.logSessionError('Center session creation failed', error);
          throw new InternalServerErrorException(
            'CENTER_SESSION_CREATION_FAILED',
            { cause: error },
          );
        }
        lastConflict = error;
      }
    }

    this.logSessionError(
      'Center session transaction retry attempts exhausted',
      lastConflict,
    );
    throw new ServiceUnavailableException('CENTER_SESSION_RETRY_EXHAUSTED', {
      cause: lastConflict,
    });
  }

  private async issueSessionTokensInTransaction(
    tx: Prisma.TransactionClient,
    centerUser: CenterUserWithCenter,
    deviceId: string,
    deviceName?: string,
  ): Promise<SessionIssueResult> {
    const existing = await tx.centerDeviceSession.findUnique({
      where: {
        center_user_id_device_id: {
          center_user_id: centerUser.id,
          device_id: deviceId,
        },
      },
    });

    if (existing && existing.revoked_at === null) {
      const tokens = await this.generateCenterTokens(
        centerUser,
        deviceId,
        existing.id,
      );
      await tx.centerDeviceSession.update({
        where: { id: existing.id },
        data: {
          refresh_token_hash: tokens.refreshTokenHash,
          device_name: deviceName?.trim() || null,
          last_used_at: new Date(),
          revoked_at: null,
        },
      });
      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        evictedSessionId: null,
      };
    }

    if (existing) {
      await tx.centerDeviceSession.delete({ where: { id: existing.id } });
    }

    let evictedSessionId: string | null = null;
    const activeSessionCount = await tx.centerDeviceSession.count({
      where: { center_user_id: centerUser.id, revoked_at: null },
    });
    if (activeSessionCount >= MAX_ACTIVE_CENTER_DEVICES) {
      const leastRecentlyUsed = await tx.centerDeviceSession.findFirst({
        where: { center_user_id: centerUser.id, revoked_at: null },
        orderBy: [{ last_used_at: 'asc' }, { created_at: 'asc' }],
        select: { id: true },
      });
      if (!leastRecentlyUsed) {
        throw new Error('CENTER_SESSION_LIMIT_STATE_INVALID');
      }
      evictedSessionId = leastRecentlyUsed.id;
      await tx.centerDeviceSession.delete({
        where: { id: leastRecentlyUsed.id },
      });
    }

    const sessionId = randomUUID();
    const tokens = await this.generateCenterTokens(
      centerUser,
      deviceId,
      sessionId,
    );
    await tx.centerDeviceSession.create({
      data: {
        id: sessionId,
        center_user_id: centerUser.id,
        device_id: deviceId,
        refresh_token_hash: tokens.refreshTokenHash,
        device_name: deviceName?.trim() || null,
        last_used_at: new Date(),
        revoked_at: null,
      },
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      evictedSessionId,
    };
  }

  private async generateCenterTokens(
    centerUser: Pick<CenterUser, 'id' | 'center_id'>,
    deviceId: string,
    sessionId: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    refreshTokenHash: string;
  }> {
    const tokens = this.tokenService.generateCenterTokenPair({
      centerUserId: centerUser.id,
      centerId: centerUser.center_id,
      deviceId,
      sessionId,
    });
    const refreshTokenHash = await this.tokenService.hashRefreshToken(
      tokens.refreshToken,
    );

    return { ...tokens, refreshTokenHash };
  }

  private isRetryableSessionConflict(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error.code === 'P2002' || error.code === 'P2034')
    );
  }

  private normalizeDeviceId(deviceId: string): string {
    const normalized = deviceId?.trim();
    if (!normalized) {
      throw new BadRequestException('DEVICE_ID_REQUIRED');
    }
    return normalized;
  }

  private async updateCenterLastSeen(centerUserId: string): Promise<void> {
    try {
      await this.prisma.centerUser.update({
        where: { id: centerUserId },
        data: { last_seen_at: new Date() },
      });
    } catch (error) {
      this.logSessionError('Center last-seen update failed', error);
      throw new InternalServerErrorException('CENTER_LAST_SEEN_UPDATE_FAILED', {
        cause: error,
      });
    }
  }

  private logSessionError(message: string, error: unknown): void {
    const stack = error instanceof Error ? error.stack : undefined;
    this.logger.error(message, stack);
  }

  private async revokeCachedSession(sessionId: string): Promise<void> {
    try {
      await this.valkeyService?.revokeSession(sessionId);
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(
        `Center session cache revocation failed (${errorName}); database state remains authoritative`,
      );
    }
  }
}
