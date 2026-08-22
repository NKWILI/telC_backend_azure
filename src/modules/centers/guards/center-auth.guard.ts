import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { CenterAccessTokenPayload } from '../../../shared/interfaces/token-payload.interface';
import { PrismaService } from '../../../shared/services/prisma.service';
import { ValkeyService } from '../../../shared/services/valkey.service';
import { TokenService } from '../../auth/token.service';

export interface CenterAuthenticatedRequest extends Request {
  centerUser?: CenterAccessTokenPayload;
}

/**
 * Authenticates center users, and is the piece that makes center logout mean
 * anything: until a guard checks the session, a revoked refresh token still
 * leaves its access token working until expiry.
 *
 * Only `verifyCenterAccessToken` is used, so a student or guest token cannot
 * cross into center routes — the student guard refuses center tokens for the
 * same reason, from the other side.
 */
@Injectable()
export class CenterAuthGuard implements CanActivate {
  constructor(
    private readonly tokenService: TokenService,
    private readonly valkeyService: ValkeyService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<CenterAuthenticatedRequest>();

    const payload = this.verifyBearerToken(request);
    await this.assertSessionActive(payload);

    request.centerUser = payload;
    return true;
  }

  private verifyBearerToken(
    request: CenterAuthenticatedRequest,
  ): CenterAccessTokenPayload {
    const header = request.headers['authorization'];
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('INVALID_CENTER_ACCESS_TOKEN');
    }

    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException('INVALID_CENTER_ACCESS_TOKEN');
    }

    return this.tokenService.verifyCenterAccessToken(token);
  }

  /**
   * The cache is the fast path; the database is the authority. A cache that
   * cannot answer (`null`) must not be read as "not revoked", or logout would
   * silently stop working whenever Valkey is down.
   */
  private async assertSessionActive(
    payload: CenterAccessTokenPayload,
  ): Promise<void> {
    const revoked = await this.valkeyService.isSessionRevoked(
      payload.sessionId,
    );
    if (revoked === true) {
      throw new UnauthorizedException('CENTER_SESSION_REVOKED');
    }
    if (revoked !== null) {
      return;
    }

    let activeSession: { id: string } | null;
    try {
      activeSession = await this.prisma.centerDeviceSession.findFirst({
        where: {
          id: payload.sessionId,
          center_user_id: payload.centerUserId,
          device_id: payload.deviceId,
          revoked_at: null,
        },
        select: { id: true },
      });
    } catch {
      // A database outage is not an authentication failure. Reporting it as
      // 401 would tell every signed-in center user their session died.
      throw new ServiceUnavailableException(
        'CENTER_SESSION_VERIFICATION_UNAVAILABLE',
      );
    }

    if (!activeSession) {
      throw new UnauthorizedException('CENTER_SESSION_REVOKED');
    }
  }
}
