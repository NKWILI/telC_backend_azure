import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { TokenService } from '../../modules/auth/token.service';
import { ValkeyService } from '../services/valkey.service';
import { PrismaService } from '../services/prisma.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokenService: TokenService,
    private readonly valkeyService: ValkeyService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('INVALID_ACCESS_TOKEN');
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      throw new UnauthorizedException('INVALID_ACCESS_TOKEN');
    }

    try {
      const payload = this.tokenService.verifyAccessToken(token);
      if (!payload.isGuest && !payload.sessionId) {
        throw new UnauthorizedException('INVALID_ACCESS_TOKEN');
      }
      if (payload.sessionId) {
        const revoked = await this.valkeyService.isSessionRevoked(
          payload.sessionId,
        );
        if (revoked === true) {
          throw new UnauthorizedException('SESSION_REVOKED');
        }
        if (revoked === null) {
          let activeSession: { id: string } | null;
          try {
            activeSession = await this.prisma.deviceSession.findFirst({
              where: {
                id: payload.sessionId,
                student_id: payload.studentId,
                device_id: payload.deviceId,
                revoked_at: null,
              },
              select: { id: true },
            });
          } catch {
            throw new ServiceUnavailableException(
              'SESSION_VERIFICATION_UNAVAILABLE',
            );
          }
          if (!activeSession) {
            throw new UnauthorizedException('SESSION_REVOKED');
          }
        }
      }
      // Attach the decoded payload to the request for downstream use
      request.student = payload;
      return true;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new UnauthorizedException('INVALID_ACCESS_TOKEN');
    }
  }
}
