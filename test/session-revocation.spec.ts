import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { TokenService } from '../src/modules/auth/token.service';
import { RateLimitService } from '../src/shared/services/rate-limit.service';
import { JwtAuthGuard } from '../src/shared/guards/jwt-auth.guard';
import { ValkeyService } from '../src/shared/services/valkey.service';

describe('session revocation', () => {
  it('rejects an access token after its session is revoked', async () => {
    const tokenService = {
      verifyAccessToken: jest.fn().mockReturnValue({
        type: 'access',
        studentId: 'student-1',
        deviceId: 'device-1',
        sessionId: 'session-1',
      }),
    } as unknown as TokenService;
    const valkey = {
      isSessionRevoked: jest.fn().mockResolvedValue(true),
    } as unknown as ValkeyService;
    const guard = new JwtAuthGuard(tokenService, valkey);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization: 'Bearer token' } }),
      }),
    } as any;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('revokes a session when an old rotated refresh token is replayed', async () => {
    const authService = {
      validateRefreshToken: jest.fn().mockResolvedValue({
        device_id: 'device-1',
        refresh_token_hash: 'current-hash',
      }),
      revokeDeviceSession: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuthService;
    const tokenService = {
      verifyRefreshToken: jest.fn().mockReturnValue({
        studentId: 'student-1',
        deviceId: 'device-1',
        sessionId: 'session-1',
      }),
      compareRefreshToken: jest.fn().mockResolvedValue(false),
    } as unknown as TokenService;
    const controller = new AuthController(
      authService,
      tokenService,
      {} as RateLimitService,
    );

    await expect(
      controller.refresh({ refreshToken: 'old-token' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authService.revokeDeviceSession).toHaveBeenCalledWith('session-1');
  });
});
