import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { TokenService } from '../../modules/auth/token.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokenService: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
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
      // Attach the decoded payload to the request for downstream use
      request.student = payload;
      return true;
    } catch (error) {
      throw new UnauthorizedException('INVALID_ACCESS_TOKEN');
    }
  }
}
