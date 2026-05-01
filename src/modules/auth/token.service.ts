import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcryptjs';
import {
  AccessTokenPayload,
  RefreshTokenPayload,
  LinkingTokenPayload,
} from '../../shared/interfaces/token-payload.interface';

@Injectable()
export class TokenService {
  private readonly jwtSecret: string;
  private readonly accessTokenExpiry: string;
  private readonly refreshTokenExpiry: string;

  constructor() {
    this.jwtSecret = process.env.JWT_SECRET || 'fallback-dev-secret';
    this.accessTokenExpiry = process.env.JWT_ACCESS_TOKEN_EXPIRY || '15m';
    this.refreshTokenExpiry = process.env.JWT_REFRESH_TOKEN_EXPIRY || '7d';
  }

  /**
   * Generate an access token (short-lived, 15 minutes)
   * Contains: studentId, deviceId
   */
  generateAccessToken(payload: {
    studentId: string;
    deviceId: string;
  }): string {
    return jwt.sign(
      {
        studentId: payload.studentId,
        deviceId: payload.deviceId,
      },
      this.jwtSecret,
      { expiresIn: this.accessTokenExpiry as jwt.SignOptions['expiresIn'] },
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
        studentId: payload.studentId,
        deviceId: payload.deviceId,
        sessionId: payload.sessionId,
      },
      this.jwtSecret,
      { expiresIn: this.refreshTokenExpiry as jwt.SignOptions['expiresIn'] },
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
      const decoded = jwt.verify(token, this.jwtSecret) as AccessTokenPayload;
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
      const decoded = jwt.verify(token, this.jwtSecret) as RefreshTokenPayload;
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
   * Hash a refresh token before storing in DB
   * Uses bcrypt with cost factor 10
   */
  async hashRefreshToken(token: string): Promise<string> {
    return bcrypt.hash(token, 10);
  }

  /**
   * Compare a plain refresh token with its stored hash
   */
  async compareRefreshToken(token: string, hash: string): Promise<boolean> {
    return bcrypt.compare(token, hash);
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
        email: payload.email,
        provider: payload.provider,
        providerId: payload.providerId,
      },
      this.jwtSecret,
      { expiresIn: '30m' },
    );
  }

  /**
   * Verify and decode a linking token
   */
  verifyLinkingToken(token: string): LinkingTokenPayload {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as LinkingTokenPayload;
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
