import { HttpException, HttpStatus } from '@nestjs/common';
import { AuthController } from '../src/modules/auth/auth.controller';

/**
 * POST /api/auth/register was the only unauthenticated write endpoint in the
 * auth module with no rate limit at all. These tests pin the wiring: the limit
 * is checked before any work happens, and it is keyed on both the caller's IP
 * and the submitted address.
 */
describe('AuthController.register rate limiting', () => {
  let controller: AuthController;
  let authService: { register: jest.Mock };
  let rateLimitService: { checkRegisterLimit: jest.Mock };

  const dto = {
    firstName: 'Anna',
    lastName: 'Beck',
    email: 'anna@example.com',
    password: 'password123',
  };

  beforeEach(() => {
    authService = {
      register: jest.fn().mockResolvedValue({
        message: 'verification email sent',
      }),
    };
    rateLimitService = { checkRegisterLimit: jest.fn() };

    controller = new AuthController(
      authService as never,
      {} as never,
      rateLimitService as never,
    );
  });

  it('checks the limit with the caller IP and the submitted email', async () => {
    await controller.register('203.0.113.7', dto);

    expect(rateLimitService.checkRegisterLimit).toHaveBeenCalledWith(
      '203.0.113.7',
      'anna@example.com',
    );
  });

  it('still registers when the limit is not exceeded', async () => {
    await expect(controller.register('203.0.113.7', dto)).resolves.toEqual({
      message: 'verification email sent',
    });

    expect(authService.register).toHaveBeenCalledWith(dto);
  });

  it('rejects with 429 and never reaches the service when the limit is hit', async () => {
    rateLimitService.checkRegisterLimit.mockImplementation(() => {
      throw new HttpException(
        'RATE_LIMIT_EXCEEDED',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    });

    await expect(controller.register('203.0.113.7', dto)).rejects.toThrow(
      HttpException,
    );

    // The important half: no database write, no verification token rotated,
    // no email sent. Rate limiting a write endpoint after the write would be
    // pointless — the token overwrite is the thing being abused.
    expect(authService.register).not.toHaveBeenCalled();
  });

  it('falls back to a placeholder key when the IP is unavailable', async () => {
    await controller.register('', dto);

    expect(rateLimitService.checkRegisterLimit).toHaveBeenCalledWith(
      'unknown',
      'anna@example.com',
    );
  });
});
