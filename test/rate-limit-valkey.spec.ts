import { HttpException, HttpStatus } from '@nestjs/common';
import { RateLimitService } from '../src/shared/services/rate-limit.service';
import { ValkeyService } from '../src/shared/services/valkey.service';

describe('RateLimitService with Valkey', () => {
  it('uses the shared Valkey bucket instead of instance-local state', async () => {
    const enforce = jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const valkey = { enforce } as unknown as ValkeyService;
    const firstInstance = new RateLimitService(valkey);
    const secondInstance = new RateLimitService(valkey);

    await firstInstance.checkForgotPasswordLimit('203.0.113.10');

    await expect(
      secondInstance.checkForgotPasswordLimit('203.0.113.10'),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
    expect(enforce).toHaveBeenCalledWith([
      {
        key: 'ratelimit:auth:forgot-password:203.0.113.10',
        max: 5,
        ttlSeconds: 900,
      },
    ]);
  });

  it('falls back to the local limiter when Valkey is unavailable', async () => {
    process.env.RATE_LIMIT_GUEST_SESSION_MAX_ATTEMPTS = '1';
    const valkey = {
      enforce: jest.fn().mockResolvedValue(null),
    } as unknown as ValkeyService;
    const service = new RateLimitService(valkey);

    await service.checkGuestSessionLimit('203.0.113.20');
    await expect(
      service.checkGuestSessionLimit('203.0.113.20'),
    ).rejects.toBeInstanceOf(HttpException);
    delete process.env.RATE_LIMIT_GUEST_SESSION_MAX_ATTEMPTS;
  });

  it('atomically limits login by both IP and normalized email', async () => {
    const enforce = jest.fn().mockResolvedValue(true);
    const service = new RateLimitService({
      enforce,
    } as unknown as ValkeyService);

    await service.checkLoginLimit('203.0.113.30', ' User@Example.COM ');

    expect(enforce).toHaveBeenCalledWith([
      { key: 'ratelimit:auth:login:ip:203.0.113.30', max: 20, ttlSeconds: 900 },
      {
        key: 'ratelimit:auth:login:email:user@example.com',
        max: 10,
        ttlSeconds: 900,
      },
    ]);
  });

  it('uses center-specific distributed registration buckets', async () => {
    const enforce = jest.fn().mockResolvedValue(true);
    const service = new RateLimitService({
      enforce,
    } as unknown as ValkeyService);

    await service.checkCenterRegisterLimit(
      '203.0.113.40',
      ' Manager@Example.COM ',
    );

    expect(enforce).toHaveBeenCalledWith([
      {
        key: 'ratelimit:centers:register:email:manager@example.com',
        max: 5,
        ttlSeconds: 3600,
      },
      {
        key: 'ratelimit:centers:register:ip:203.0.113.40',
        max: 20,
        ttlSeconds: 3600,
      },
    ]);
  });

  it('uses center-specific distributed login buckets', async () => {
    const enforce = jest.fn().mockResolvedValue(true);
    const service = new RateLimitService({
      enforce,
    } as unknown as ValkeyService);

    await service.checkCenterLoginLimit(
      '203.0.113.50',
      ' Manager@Example.COM ',
    );

    expect(enforce).toHaveBeenCalledWith([
      {
        key: 'ratelimit:centers:login:ip:203.0.113.50',
        max: 20,
        ttlSeconds: 900,
      },
      {
        key: 'ratelimit:centers:login:email:manager@example.com',
        max: 10,
        ttlSeconds: 900,
      },
    ]);
  });

  it('uses a center-specific distributed verification bucket', async () => {
    const enforce = jest.fn().mockResolvedValue(true);
    const service = new RateLimitService({
      enforce,
    } as unknown as ValkeyService);

    await service.checkCenterVerifyEmailLimit('203.0.113.60');

    expect(enforce).toHaveBeenCalledWith([
      {
        key: 'ratelimit:centers:verify-email:ip:203.0.113.60',
        max: 10,
        ttlSeconds: 900,
      },
    ]);
  });
});
