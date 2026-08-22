import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import {
  AccessTokenPayload,
  RefreshTokenPayload,
  LinkingTokenPayload,
} from '../../shared/interfaces/token-payload.interface';

@Injectable()
export class TokenService {
  private readonly accessTokenSecret: string;
  private readonly refreshTokenSecret: string;
  private readonly accessTokenExpiry: string;
  private readonly refreshTokenExpiry: string;
  private readonly refreshTokenHashSecret: string;
  private readonly issuer = 'lerniqo-api';
  private readonly audience = 'lerniqo-app';

  constructor() {
    this.accessTokenSecret = this.requireSecret('JWT_ACCESS_SECRET');
    this.refreshTokenSecret = this.requireSecret('JWT_REFRESH_SECRET');
    this.accessTokenExpiry = process.env.JWT_ACCESS_TOKEN_EXPIRY || '15m';
    this.refreshTokenExpiry = process.env.JWT_REFRESH_TOKEN_EXPIRY || '7d';
    // Falls back to the refresh signing secret so an existing deployment does
    // not need a new variable before it can take this fix.
    this.refreshTokenHashSecret =
      process.env.TOKEN_HMAC_SECRET || this.refreshTokenSecret;
  }

  private requireSecret(
    name: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET',
  ): string {
    const value = process.env[name];
    if (!value || value.length < 64) {
      throw new Error(`${name} must be configured with at least 64 characters`);
    }
    return value;
  }

  /**
   * Generate an access token (short-lived, 15 minutes)
   * Contains: studentId, deviceId
   */
  generateAccessToken(payload: {
    studentId: string;
    deviceId: string;
    sessionId?: string;
  }): string {
    return jwt.sign(
      {
        type: 'access',
        studentId: payload.studentId,
        deviceId: payload.deviceId,
        sessionId: payload.sessionId,
      },
      this.accessTokenSecret,
      {
        algorithm: 'HS256',
        issuer: this.issuer,
        audience: this.audience,
        expiresIn: this.accessTokenExpiry as jwt.SignOptions['expiresIn'],
      },
    );
  }

  /**
   * Generate a guest access token (2 hours).
   * Used by POST /api/auth/guest. No refresh token; guest re-calls /auth/guest if needed.
   * Payload carries isGuest:true so guards downstream can route guest requests differently.
   */
  generateGuestAccessToken(payload: { studentId: string }): string {
    return jwt.sign(
      {
        type: 'access',
        studentId: payload.studentId,
        deviceId: 'guest',
        isGuest: true,
      },
      this.accessTokenSecret,
      {
        algorithm: 'HS256',
        issuer: this.issuer,
        audience: this.audience,
        expiresIn: '2h',
      },
    );
  }

  /**
   * Generate a refresh token (long-lived, 7 days)
   * Contains: studentId, deviceId, sessionId
   */
  generateRefreshToken(payload: {
    studentId: string;
    deviceId: string;
    sessionId: string;
  }): string {
    return jwt.sign(
      {
        type: 'refresh',
        studentId: payload.studentId,
        deviceId: payload.deviceId,
        sessionId: payload.sessionId,
      },
      this.refreshTokenSecret,
      {
        algorithm: 'HS256',
        issuer: this.issuer,
        audience: this.audience,
        jwtid: randomUUID(),
        expiresIn: this.refreshTokenExpiry as jwt.SignOptions['expiresIn'],
      },
    );
  }

  /**
   * Generate both access and refresh tokens at once
   */
  generateTokenPair(payload: {
    studentId: string;
    deviceId: string;
    sessionId: string;
  }): { accessToken: string; refreshToken: string } {
    return {
      accessToken: this.generateAccessToken({
        studentId: payload.studentId,
        deviceId: payload.deviceId,
        sessionId: payload.sessionId,
      }),
      refreshToken: this.generateRefreshToken({
        studentId: payload.studentId,
        deviceId: payload.deviceId,
        sessionId: payload.sessionId,
      }),
    };
  }

  /**
   * Verify and decode an access token
   * Throws UnauthorizedException if invalid/expired
   */
  verifyAccessToken(token: string): AccessTokenPayload {
    try {
      const decoded = jwt.verify(token, this.accessTokenSecret, {
        algorithms: ['HS256'],
        issuer: this.issuer,
        audience: this.audience,
      }) as AccessTokenPayload;
      if (
        decoded.type !== 'access' ||
        typeof decoded.studentId !== 'string' ||
        typeof decoded.deviceId !== 'string'
      ) {
        throw new UnauthorizedException('INVALID_ACCESS_TOKEN');
      }
      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedException('INVALID_ACCESS_TOKEN');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new UnauthorizedException('INVALID_ACCESS_TOKEN');
      }
      throw new UnauthorizedException('INVALID_ACCESS_TOKEN');
    }
  }

  /**
   * Verify and decode a refresh token
   * Throws UnauthorizedException if invalid/expired
   */
  verifyRefreshToken(token: string): RefreshTokenPayload {
    try {
      const decoded = jwt.verify(token, this.refreshTokenSecret, {
        algorithms: ['HS256'],
        issuer: this.issuer,
        audience: this.audience,
      }) as RefreshTokenPayload;
      if (
        decoded.type !== 'refresh' ||
        typeof decoded.studentId !== 'string' ||
        typeof decoded.deviceId !== 'string' ||
        typeof decoded.sessionId !== 'string'
      ) {
        throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
      }
      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
      }
      throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
    }
  }

  /**
   * Hash a refresh token before storing it.
   *
   * HMAC-SHA256, deliberately not bcrypt. bcrypt truncates its input at 72
   * bytes, and a refresh token is a ~400-byte JWT whose first 72 bytes —
   * header plus the opening of the payload — are identical for every token
   * issued to the same session. Hashing one with bcrypt therefore made a spent
   * token compare equal to its replacement, so rotation was never single-use
   * and a leaked refresh token stayed valid for its whole lifetime.
   *
   * bcrypt earns its cost for low-entropy secrets that people choose. A signed
   * JWT already carries far more entropy than any password, so there is
   * nothing to slow an attacker down against — a fast keyed digest over the
   * *whole* input is both correct and cheaper.
   *
   * Kept async so every existing caller keeps working unchanged.
   */
  async hashRefreshToken(token: string): Promise<string> {
    return Promise.resolve(this.digestRefreshToken(token));
  }

  /**
   * Compare a presented refresh token with its stored hash, in constant time.
   */
  async compareRefreshToken(token: string, hash: string): Promise<boolean> {
    const expected = Buffer.from(this.digestRefreshToken(token), 'utf8');
    const stored = Buffer.from(hash ?? '', 'utf8');

    // timingSafeEqual throws on a length mismatch, which any legacy bcrypt
    // hash will be. Those cannot be verified any more by design, so they fail
    // closed and the student signs in again.
    if (expected.length !== stored.length) {
      return Promise.resolve(false);
    }

    return Promise.resolve(timingSafeEqual(expected, stored));
  }

  private digestRefreshToken(token: string): string {
    return createHmac('sha256', this.refreshTokenHashSecret)
      .update(token)
      .digest('hex');
  }

  /**
   * Generate a linking token for OAuth account linking (30 minutes)
   * Contains: email, provider, providerId
   */
  generateLinkingToken(payload: {
    email: string;
    provider: string;
    providerId: string;
  }): string {
    return jwt.sign(
      {
        type: 'linking',
        email: payload.email,
        provider: payload.provider,
        providerId: payload.providerId,
      },
      this.accessTokenSecret,
      {
        algorithm: 'HS256',
        issuer: this.issuer,
        audience: this.audience,
        expiresIn: '30m',
      },
    );
  }

  /**
   * Verify and decode a linking token
   */
  verifyLinkingToken(token: string): LinkingTokenPayload {
    try {
      const decoded = jwt.verify(token, this.accessTokenSecret, {
        algorithms: ['HS256'],
        issuer: this.issuer,
        audience: this.audience,
      }) as LinkingTokenPayload;
      if (
        decoded.type !== 'linking' ||
        typeof decoded.email !== 'string' ||
        typeof decoded.provider !== 'string' ||
        typeof decoded.providerId !== 'string'
      ) {
        throw new UnauthorizedException('LINKING_TOKEN_INVALID');
      }
      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedException('LINKING_TOKEN_EXPIRED');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new UnauthorizedException('LINKING_TOKEN_INVALID');
      }
      throw new UnauthorizedException('LINKING_TOKEN_INVALID');
    }
  }
}
