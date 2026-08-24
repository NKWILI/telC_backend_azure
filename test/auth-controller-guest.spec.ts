import { HttpException, HttpStatus } from '@nestjs/common';
import { AuthController } from '../src/modules/auth/auth.controller';
import { TokenService } from '../src/modules/auth/token.service';

describe('AuthController.createGuestSession', () => {
  let controller: AuthController;
  let tokenService: TokenService;
  let rateLimitService: {
    checkGuestSessionLimit: jest.Mock;
  };

  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET =
      'test-access-secret-for-guest-controller-tests-that-is-at-least-64-characters';
    process.env.JWT_REFRESH_SECRET =
      'test-refresh-secret-for-guest-controller-tests-that-is-at-least-64-characters';
    process.env.JWT_ACCESS_TOKEN_EXPIRY = '15m';
  });

  beforeEach(() => {
    tokenService = new TokenService();
    rateLimitService = {
      checkGuestSessionLimit: jest.fn(),
    };

    // AuthController has many deps; only the ones the guest endpoint touches need
    // real implementations. The rest are stubs of stubs.
    controller = new AuthController(
      {} as never,
      tokenService,
      rateLimitService as never,
      { forStudent: jest.fn() } as never,
    );
  });

  it('returns a valid guest JWT with isGuest:true and expiresIn 7200', async () => {
    const res = await controller.createGuestSession('203.0.113.7');

    expect(res.isGuest).toBe(true);
    expect(res.expiresIn).toBe(7200);
    expect(typeof res.accessToken).toBe('string');
    expect(res.accessToken.split('.')).toHaveLength(3);

    const decoded = tokenService.verifyAccessToken(res.accessToken);
    expect(decoded.isGuest).toBe(true);
    expect(decoded.deviceId).toBe('guest');
    expect(typeof decoded.studentId).toBe('string');
    expect(decoded.studentId.length).toBeGreaterThan(10); // looks like a uuid
  });

  it('each call mints a unique studentId', async () => {
    const a = await controller.createGuestSession('1.1.1.1');
    const b = await controller.createGuestSession('1.1.1.1');

    const decodedA = tokenService.verifyAccessToken(a.accessToken);
    const decodedB = tokenService.verifyAccessToken(b.accessToken);

    expect(decodedA.studentId).not.toBe(decodedB.studentId);
  });

  it('invokes the rate limiter with the request IP', async () => {
    await controller.createGuestSession('192.168.1.42');

    expect(rateLimitService.checkGuestSessionLimit).toHaveBeenCalledWith(
      '192.168.1.42',
    );
  });

  it('uses "unknown" when IP is empty', async () => {
    await controller.createGuestSession('');

    expect(rateLimitService.checkGuestSessionLimit).toHaveBeenCalledWith(
      'unknown',
    );
  });

  it('propagates 429 from the rate limiter', async () => {
    rateLimitService.checkGuestSessionLimit.mockImplementation(() => {
      throw new HttpException(
        'RATE_LIMIT_EXCEEDED',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    });

    await expect(controller.createGuestSession('1.2.3.4')).rejects.toThrow(
      HttpException,
    );
  });
});
