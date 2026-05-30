import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AccessTokenPayload } from '../interfaces/token-payload.interface';

/**
 * Blocks requests authenticated with a guest JWT (isGuest === true).
 * MUST be applied AFTER JwtAuthGuard so request.student is populated.
 * Use:
 *   @UseGuards(JwtAuthGuard, GuestBlockGuard)
 */
@Injectable()
export class GuestBlockGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const student = req.student as AccessTokenPayload | undefined;

    if (student?.isGuest === true) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'This feature requires a registered account',
        messageKey: 'guestNotAllowed',
      });
    }

    return true;
  }
}
