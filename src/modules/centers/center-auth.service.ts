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
import {
  Prisma,
  type CenterDeviceSession,
  type CenterUser,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomUUID, timingSafeEqual } from 'crypto';
import type { CenterRefreshTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { PrismaService } from '../../shared/services/prisma.service';
import { ValkeyService } from '../../shared/services/valkey.service';
import { TokenCryptoService } from '../auth/token-crypto.service';
import { EmailService } from '../auth/email.service';
import { TokenService } from '../auth/token.service';
import {
  CenterAuthResponseDto,
  CenterLogoutResponseDto,
  CenterMessageResponseDto,
  CenterTokenPairDto,
} from './dto/center-auth-response.dto';

const MAX_ACTIVE_CENTER_DEVICES = 3;
const SESSION_TRANSACTION_ATTEMPTS = 2;
const PASSWORD_RESET_CODE_TTL_MS = 10 * 60 * 1000;
const PASSWORD_RESET_RESPONSE = {
  message: 'If that account exists, a reset code was sent.',
} as const;
/**
 * Prisma's own default is 5s. That is not much once a serverless Postgres
 * resumes from idle, and the transaction also pays for a bcrypt hash of the
 * refresh token. Budget generously; the retry below covers what still expires.
 */
const SESSION_TRANSACTION_TIMEOUT_MS = 15_000;
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

export interface CenterForgotPasswordInput {
  email: string;
}

export interface CenterResetPasswordInput {
  email: string;
  code: string;
  newPassword: string;
  deviceId: string;
  deviceName?: string;
}

export interface CenterRefreshInput {
  refreshToken: string;
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
    private readonly emailService: EmailService,
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

  /**
   * Exchanges a center refresh token for a new pair, rotating the stored hash.
   *
   * Only `verifyCenterRefreshToken` is used, so a student or guest token can
   * never reach a center session. Infrastructure failures are deliberately not
   * caught: collapsing them into 401 would report a database outage as a
   * credential problem and hide it from error monitoring.
   */
  async refresh(input: CenterRefreshInput): Promise<CenterTokenPairDto> {
    const payload = this.tokenService.verifyCenterRefreshToken(
      input.refreshToken,
    );

    const session = await this.prisma.centerDeviceSession.findFirst({
      where: {
        id: payload.sessionId,
        center_user_id: payload.centerUserId,
        revoked_at: null,
      },
    });

    const ownedSession = this.resolveSessionOwnedByToken(
      session,
      payload,
      input.refreshToken,
    );

    const tokens = this.tokenService.generateCenterTokenPair({
      centerUserId: payload.centerUserId,
      centerId: payload.centerId,
      deviceId: payload.deviceId,
      sessionId: payload.sessionId,
    });
    const newRefreshTokenHash = this.hashCenterRefreshToken(
      tokens.refreshToken,
    );

    // The expected-hash predicate is the compare-and-swap. Two requests holding
    // the same token both pass the checks above, but only the first update
    // matches; the loser affects zero rows and is rejected as a replay.
    const rotated = await this.rotateDeviceSessionRefreshHash(
      payload.centerUserId,
      payload.sessionId,
      ownedSession.refresh_token_hash,
      newRefreshTokenHash,
    );
    if (!rotated) {
      throw new UnauthorizedException('INVALID_CENTER_REFRESH_TOKEN');
    }

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  /**
   * Revokes exactly the session the presented refresh token belongs to.
   *
   * Idempotent by design: a session that is already revoked or already deleted
   * is the desired end state, so repeating logout succeeds. A token that no
   * longer matches the stored hash is not idempotent — it is a stale token
   * trying to revoke the session that replaced it, and is refused.
   */
  async logout(input: CenterRefreshInput): Promise<CenterLogoutResponseDto> {
    const payload = this.tokenService.verifyCenterRefreshToken(
      input.refreshToken,
    );

    const session = await this.prisma.centerDeviceSession.findFirst({
      where: {
        id: payload.sessionId,
        center_user_id: payload.centerUserId,
      },
    });

    if (!session) {
      return { success: true };
    }
    if (session.device_id !== payload.deviceId) {
      throw new UnauthorizedException('INVALID_CENTER_REFRESH_TOKEN');
    }
    if (session.revoked_at !== null) {
      return { success: true };
    }

    const presentedTokenMatches = this.centerRefreshTokenMatches(
      input.refreshToken,
      session.refresh_token_hash,
    );
    if (!presentedTokenMatches) {
      throw new UnauthorizedException('INVALID_CENTER_REFRESH_TOKEN');
    }

    // Possession is already proven above, so the revoke is not conditioned on
    // the hash. A refresh racing this logout must not leave the session alive.
    await this.prisma.centerDeviceSession.updateMany({
      where: {
        id: payload.sessionId,
        center_user_id: payload.centerUserId,
        revoked_at: null,
      },
      data: { revoked_at: new Date() },
    });

    await this.revokeCachedSession(payload.sessionId);

    return { success: true };
  }

  /**
   * Every rejection uses one error code so a caller cannot tell a revoked
   * session from a wrong device from a replayed token.
   */
  private resolveSessionOwnedByToken(
    session: CenterDeviceSession | null,
    payload: CenterRefreshTokenPayload,
    presentedToken: string,
  ): CenterDeviceSession {
    if (!session || session.device_id !== payload.deviceId) {
      throw new UnauthorizedException('INVALID_CENTER_REFRESH_TOKEN');
    }

    const presentedTokenMatches = this.centerRefreshTokenMatches(
      presentedToken,
      session.refresh_token_hash,
    );
    if (!presentedTokenMatches) {
      throw new UnauthorizedException('INVALID_CENTER_REFRESH_TOKEN');
    }

    return session;
  }

  /**
   * Always answers the same thing. An address that has no center account and
   * one that does must be indistinguishable, so the absent case returns early
   * rather than reporting anything, and a delivery failure is logged instead
   * of surfaced — a 502 here would be an enumeration oracle of its own.
   */
  async forgotPassword(
    input: CenterForgotPasswordInput,
  ): Promise<CenterMessageResponseDto> {
    const email = input.email.trim().toLowerCase();
    const centerUser = await this.prisma.centerUser.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!centerUser) {
      return PASSWORD_RESET_RESPONSE;
    }

    const rawCode = this.tokenCrypto.generateNumericCode(6);
    await this.prisma.centerUser.update({
      where: { id: centerUser.id },
      data: {
        password_reset_token: this.tokenCrypto.hashToken(rawCode),
        password_reset_expires: new Date(
          Date.now() + PASSWORD_RESET_CODE_TTL_MS,
        ),
      },
    });

    try {
      await this.emailService.sendCenterPasswordResetEmail(email, rawCode);
    } catch (error) {
      this.logSessionError(
        'Center password-reset email delivery failed',
        error,
      );
    }

    return PASSWORD_RESET_RESPONSE;
  }

  /**
   * Consumes the code and rotates the password in one predicated update, so a
   * code cannot be redeemed twice. Every existing center session is revoked —
   * whoever knew the old password loses their devices — and the caller gets a
   * fresh session for the device that performed the reset.
   */
  async resetPassword(
    input: CenterResetPasswordInput,
  ): Promise<CenterAuthResponseDto> {
    const deviceId = this.normalizeDeviceId(input.deviceId);
    const email = input.email.trim().toLowerCase();
    const codeHash = this.tokenCrypto.hashToken(input.code.trim());

    const centerUser = await this.prisma.centerUser.findFirst({
      where: { email, password_reset_token: codeHash },
      include: { center: true },
    });

    if (!centerUser) {
      throw new BadRequestException('RESET_CODE_INVALID');
    }

    const now = new Date();
    if (
      !centerUser.password_reset_expires ||
      centerUser.password_reset_expires <= now
    ) {
      throw new BadRequestException('RESET_CODE_EXPIRED');
    }

    const passwordHash = await bcrypt.hash(input.newPassword, 12);
    const consumed = await this.prisma.centerUser.updateMany({
      where: {
        id: centerUser.id,
        password_reset_token: codeHash,
        password_reset_expires: { gt: now },
      },
      data: {
        password_hash: passwordHash,
        password_reset_token: null,
        password_reset_expires: null,
      },
    });

    if (consumed.count !== 1) {
      throw new BadRequestException('RESET_CODE_INVALID');
    }

    await this.revokeAllCenterSessions(centerUser.id);

    return this.issueAuthResponse(
      { ...centerUser, password_hash: passwordHash },
      deviceId,
      input.deviceName,
    );
  }

  /**
   * Center sessions only. A center password reset must never reach a student's
   * DeviceSession rows, even for a person who holds both kinds of account.
   */
  private async revokeAllCenterSessions(centerUserId: string): Promise<void> {
    const sessions = await this.prisma.centerDeviceSession.findMany({
      where: { center_user_id: centerUserId, revoked_at: null },
      select: { id: true },
    });

    await this.prisma.centerDeviceSession.updateMany({
      where: { center_user_id: centerUserId, revoked_at: null },
      data: { revoked_at: new Date() },
    });

    for (const session of sessions) {
      await this.revokeCachedSession(session.id);
    }
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
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            timeout: SESSION_TRANSACTION_TIMEOUT_MS,
          },
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
      const tokens = this.generateCenterTokens(
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
    const tokens = this.generateCenterTokens(centerUser, deviceId, sessionId);
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

  private generateCenterTokens(
    centerUser: Pick<CenterUser, 'id' | 'center_id'>,
    deviceId: string,
    sessionId: string,
  ): {
    accessToken: string;
    refreshToken: string;
    refreshTokenHash: string;
  } {
    const tokens = this.tokenService.generateCenterTokenPair({
      centerUserId: centerUser.id,
      centerId: centerUser.center_id,
      deviceId,
      sessionId,
    });
    const refreshTokenHash = this.hashCenterRefreshToken(tokens.refreshToken);

    return { ...tokens, refreshTokenHash };
  }

  /**
   * P2002 and P2034 are the write-conflict codes this transaction races on.
   *
   * P2028 is a transaction timeout, and it belongs here for a reason found by
   * running this against a real serverless Postgres: the first request after
   * the compute resumes from idle can outlast the budget, and that surfaced as
   * a 500 on login rather than a retry. A timed-out transaction has already
   * rolled back, so re-running it is safe — and by the second attempt the
   * database is warm.
   */
  /**
   * HMAC-SHA256, deliberately not bcrypt.
   *
   * bcrypt truncates its input at 72 bytes, and a refresh token is a ~400-byte
   * JWT whose first 72 bytes — header plus the opening of the payload — are
   * identical for every token issued to the same session. Hashing one with
   * bcrypt therefore makes a spent token compare equal to its replacement, and
   * rotation stops being single-use. An e2e run with real crypto caught this;
   * mocked comparisons cannot.
   *
   * bcrypt is for low-entropy secrets people choose. A signed JWT already
   * carries far more entropy than a password, so a fast keyed digest is both
   * correct and cheap — and cheap matters, because this runs inside the
   * Serializable session transaction.
   */
  private hashCenterRefreshToken(token: string): string {
    return this.tokenCrypto.hashToken(token);
  }

  private centerRefreshTokenMatches(
    token: string,
    storedHash: string,
  ): boolean {
    const candidate = Buffer.from(this.hashCenterRefreshToken(token));
    const stored = Buffer.from(storedHash);
    return (
      candidate.length === stored.length && timingSafeEqual(candidate, stored)
    );
  }

  private isRetryableSessionConflict(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }

    const code = (error as { code?: unknown }).code;
    if (code === 'P2002' || code === 'P2034' || code === 'P2028') {
      return true;
    }

    // Prisma's driver adapter reports the Serializable conflict itself as a
    // DriverAdapterError carrying a message and no `code` at all, so a
    // code-only predicate silently never matched the one condition this retry
    // loop exists for. Found by running concurrent logins against real
    // Postgres; a mocked client cannot produce this shape.
    const message = (error as { message?: unknown }).message;
    return (
      typeof message === 'string' &&
      /TransactionWriteConflict|write conflict|deadlock|could not serialize/i.test(
        message,
      )
    );
  }

  private normalizeDeviceId(deviceId: string): string {
    const normalized = deviceId?.trim();
    if (!normalized) {
      throw new BadRequestException('DEVICE_ID_REQUIRED');
    }
    return normalized;
  }

  /**
   * Best-effort telemetry. By the time this runs the session is committed and
   * the tokens are minted — and on a new device another session has already
   * been evicted — so failing the request here would charge the caller the
   * full cost of a successful login and hand back an error instead of the
   * tokens. The write is worth a log line, not the session.
   */
  private async updateCenterLastSeen(centerUserId: string): Promise<void> {
    try {
      await this.prisma.centerUser.update({
        where: { id: centerUserId },
        data: { last_seen_at: new Date() },
      });
    } catch (error) {
      this.logSessionError('Center last-seen update failed', error);
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
