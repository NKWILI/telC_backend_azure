/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import {
  ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { CenterAuthGuard } from '../src/modules/centers/guards/center-auth.guard';

describe('CenterAuthGuard', () => {
  const payload = {
    type: 'access',
    actorType: 'CENTER_USER',
    centerUserId: 'owner-1',
    centerId: 'center-1',
    deviceId: 'browser-1',
    sessionId: 'center-session-1',
  };

  let tokenService: any;
  let valkeyService: any;
  let prisma: any;
  let guard: CenterAuthGuard;
  let request: any;

  const contextFor = (headers: Record<string, string>): ExecutionContext => {
    request = { headers };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as ExecutionContext;
  };

  beforeEach(() => {
    tokenService = {
      verifyCenterAccessToken: jest.fn().mockReturnValue({ ...payload }),
    };
    valkeyService = {
      isSessionRevoked: jest.fn().mockResolvedValue(false),
    };
    prisma = {
      centerDeviceSession: {
        findFirst: jest.fn().mockResolvedValue({ id: 'center-session-1' }),
      },
      get deviceSession(): never {
        throw new Error('Student DeviceSession must never be accessed');
      },
    };
    guard = new CenterAuthGuard(tokenService, valkeyService, prisma);
  });

  it('admits a valid center access token and attaches the payload', async () => {
    const context = contextFor({ authorization: 'Bearer center-access-token' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(tokenService.verifyCenterAccessToken).toHaveBeenCalledWith(
      'center-access-token',
    );
    expect(request.centerUser).toEqual(payload);
  });

  it.each([
    ['a missing header', {}],
    ['a non-bearer scheme', { authorization: 'Basic abc' }],
    ['an empty bearer token', { authorization: 'Bearer ' }],
  ])('rejects %s', async (_case, headers) => {
    await expect(guard.canActivate(contextFor(headers))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a student or guest token, which the center verifier refuses', async () => {
    tokenService.verifyCenterAccessToken.mockImplementation(() => {
      throw new UnauthorizedException('INVALID_CENTER_ACCESS_TOKEN');
    });

    await expect(
      guard.canActivate(contextFor({ authorization: 'Bearer student-token' })),
    ).rejects.toThrow(UnauthorizedException);
    expect(prisma.centerDeviceSession.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a token whose session the cache reports revoked', async () => {
    valkeyService.isSessionRevoked.mockResolvedValue(true);

    await expect(
      guard.canActivate(contextFor({ authorization: 'Bearer revoked-token' })),
    ).rejects.toThrow('CENTER_SESSION_REVOKED');
    expect(prisma.centerDeviceSession.findFirst).not.toHaveBeenCalled();
  });

  it('falls back to the database when the cache cannot answer', async () => {
    valkeyService.isSessionRevoked.mockResolvedValue(null);

    await expect(
      guard.canActivate(contextFor({ authorization: 'Bearer center-token' })),
    ).resolves.toBe(true);
    expect(prisma.centerDeviceSession.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'center-session-1',
        center_user_id: 'owner-1',
        device_id: 'browser-1',
        revoked_at: null,
      },
      select: { id: true },
    });
  });

  it('rejects when the cache is silent and no active session remains', async () => {
    valkeyService.isSessionRevoked.mockResolvedValue(null);
    prisma.centerDeviceSession.findFirst.mockResolvedValue(null);

    await expect(
      guard.canActivate(contextFor({ authorization: 'Bearer stale-token' })),
    ).rejects.toThrow('CENTER_SESSION_REVOKED');
  });

  it('reports a database outage as 503 rather than an auth failure', async () => {
    valkeyService.isSessionRevoked.mockResolvedValue(null);
    prisma.centerDeviceSession.findFirst.mockRejectedValue(
      new Error('connection terminated'),
    );

    await expect(
      guard.canActivate(contextFor({ authorization: 'Bearer center-token' })),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
