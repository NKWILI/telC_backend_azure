import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { TokenService } from '../src/modules/auth/token.service';
import { RateLimitService } from '../src/shared/services/rate-limit.service';
import { JwtAuthGuard } from '../src/shared/guards/jwt-auth.guard';
import { ValkeyService } from '../src/shared/services/valkey.service';
import { PrismaService } from '../src/shared/services/prisma.service';

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
    const guard = new JwtAuthGuard(tokenService, valkey, {} as PrismaService);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization: 'Bearer token' } }),
      }),
    } as any;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('uses PostgreSQL when Valkey is unavailable and the session is active', async () => {
    const tokenService = {
      verifyAccessToken: jest.fn().mockReturnValue({
        type: 'access',
        studentId: 'student-1',
        deviceId: 'device-1',
        sessionId: 'session-1',
      }),
    } as unknown as TokenService;
    const valkey = {
      isSessionRevoked: jest.fn().mockResolvedValue(null),
    } as unknown as ValkeyService;
    const prisma = {
      deviceSession: {
        findFirst: jest.fn().mockResolvedValue({ id: 'session-1' }),
      },
    } as unknown as PrismaService;
    const guard = new JwtAuthGuard(tokenService, valkey, prisma);
    const request = { headers: { authorization: 'Bearer token' } } as any;
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as any;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.deviceSession.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'session-1',
        student_id: 'student-1',
        device_id: 'device-1',
        revoked_at: null,
      },
      select: { id: true },
    });
  });

  it('rejects a revoked database session when Valkey is unavailable', async () => {
    const tokenService = {
      verifyAccessToken: jest.fn().mockReturnValue({
        type: 'access',
        studentId: 'student-1',
        deviceId: 'device-1',
        sessionId: 'session-1',
      }),
    } as unknown as TokenService;
    const valkey = {
      isSessionRevoked: jest.fn().mockResolvedValue(null),
    } as unknown as ValkeyService;
    const prisma = {
      deviceSession: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const guard = new JwtAuthGuard(tokenService, valkey, prisma);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization: 'Bearer token' } }),
      }),
    } as any;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('returns 503 when neither Valkey nor PostgreSQL can verify the session', async () => {
    const tokenService = {
      verifyAccessToken: jest.fn().mockReturnValue({
        type: 'access',
        studentId: 'student-1',
        deviceId: 'device-1',
        sessionId: 'session-1',
      }),
    } as unknown as TokenService;
    const valkey = {
      isSessionRevoked: jest.fn().mockResolvedValue(null),
    } as unknown as ValkeyService;
    const prisma = {
      deviceSession: {
        findFirst: jest.fn().mockRejectedValue(new Error('database down')),
      },
    } as unknown as PrismaService;
    const guard = new JwtAuthGuard(tokenService, valkey, prisma);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization: 'Bearer token' } }),
      }),
    } as any;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('rejects an old rotated refresh token without revoking the active session', async () => {
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
    expect(authService.revokeDeviceSession).not.toHaveBeenCalled();
  });

  it('rejects the losing concurrent refresh without revoking the session', async () => {
    const authService = {
      validateRefreshToken: jest.fn().mockResolvedValue({
        device_id: 'device-1',
        refresh_token_hash: 'current-hash',
      }),
      rotateDeviceSessionRefreshHash: jest.fn().mockResolvedValue(false),
      revokeDeviceSession: jest.fn(),
    } as unknown as AuthService;
    const tokenService = {
      verifyRefreshToken: jest.fn().mockReturnValue({
        studentId: 'student-1',
        deviceId: 'device-1',
        sessionId: 'session-1',
      }),
      compareRefreshToken: jest.fn().mockResolvedValue(true),
      generateTokenPair: jest.fn().mockReturnValue({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      }),
      hashRefreshToken: jest.fn().mockResolvedValue('new-hash'),
    } as unknown as TokenService;
    const controller = new AuthController(
      authService,
      tokenService,
      {} as RateLimitService,
    );

    await expect(
      controller.refresh({ refreshToken: 'current-token' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authService.rotateDeviceSessionRefreshHash).toHaveBeenCalledWith(
      'session-1',
      'current-hash',
      'new-hash',
    );
    expect(authService.revokeDeviceSession).not.toHaveBeenCalled();
  });
});
