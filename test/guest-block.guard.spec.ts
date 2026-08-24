import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { GuestBlockGuard } from '../src/shared/guards/guest-block.guard';
import { AccessTokenPayload } from '../src/shared/interfaces/token-payload.interface';

const makeContext = (
  student: AccessTokenPayload | undefined,
): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ student }),
    }),
  }) as unknown as ExecutionContext;

describe('GuestBlockGuard', () => {
  let guard: GuestBlockGuard;

  beforeEach(() => {
    guard = new GuestBlockGuard();
  });

  it('returns true for a regular (non-guest) student', () => {
    const ctx = makeContext({
      studentId: 'real-student-1',
      deviceId: 'device-1',
      isGuest: false,
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('returns true when isGuest is undefined (legacy tokens)', () => {
    const ctx = makeContext({
      studentId: 'real-student-1',
      deviceId: 'device-1',
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws ForbiddenException with messageKey "guestNotAllowed" when isGuest=true', () => {
    const ctx = makeContext({
      studentId: 'guest-uuid',
      deviceId: 'guest',
      isGuest: true,
    });

    try {
      guard.canActivate(ctx);
      fail('expected ForbiddenException');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const response = (err as ForbiddenException).getResponse() as Record<
        string,
        unknown
      >;
      expect(response.messageKey).toBe('guestNotAllowed');
      expect(response.statusCode).toBe(403);
    }
  });

  it('returns true when req.student is undefined (no false positives)', () => {
    const ctx = makeContext(undefined);
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
