import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { CenterAccessTokenPayload } from '../../../shared/interfaces/token-payload.interface';
import type { CenterAuthenticatedRequest } from '../guards/center-auth.guard';

/**
 * Reads the center identity that `CenterAuthGuard` attached to the request.
 *
 * Handlers must take the center and center-user ids from here rather than from
 * the request body or a path parameter: these values come from a signed token,
 * so a caller cannot name a center it does not belong to.
 *
 * Usage:
 *   @UseGuards(CenterAuthGuard)
 *   @Get('me')
 *   me(@CurrentCenterUser() user: CenterAccessTokenPayload) { ... }
 */
export const CurrentCenterUser = createParamDecorator(
  (
    data: keyof CenterAccessTokenPayload | undefined,
    ctx: ExecutionContext,
  ):
    | CenterAccessTokenPayload
    | CenterAccessTokenPayload[keyof CenterAccessTokenPayload]
    | null => {
    const request = ctx.switchToHttp().getRequest<CenterAuthenticatedRequest>();
    const centerUser = request.centerUser;

    if (!centerUser) {
      return null;
    }

    return data ? centerUser[data] : centerUser;
  },
);
