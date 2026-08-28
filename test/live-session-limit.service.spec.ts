import { HttpException } from '@nestjs/common';
import { LiveSessionLimitService } from '../src/modules/speaking/live/live-session-limit.service';

const GUEST = { ip: '1.2.3.4', studentId: 'throwaway-uuid', isGuest: true };
const STUDENT = { ip: '1.2.3.4', studentId: 'student-1', isGuest: false };

/**
 * These run with no ValkeyService injected, exercising the in-process fallback.
 * That is the path a single-instance demo actually takes when VALKEY_URL is
 * unset, so it is the one that must not break.
 */
function makeService(env: Record<string, string> = {}) {
  const previous = { ...process.env };
  Object.assign(process.env, {
    ELENA_IP_DAILY_MAX: '2',
    ELENA_GLOBAL_DAILY_MAX: '50',
    ELENA_CONCURRENT_MAX: '2',
    GEMINI_LIVE_SESSION_MAX_MINUTES: '10',
    ...env,
  });
  const service = new LiveSessionLimitService();
  process.env = previous;
  return service;
}

async function messageKeyOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    throw new Error('expected the call to be refused');
  } catch (error) {
    const response = (error as HttpException).getResponse() as {
      messageKey: string;
    };
    return response.messageKey;
  }
}

describe('LiveSessionLimitService', () => {
  describe('per-identity daily cap', () => {
    it('allows exactly the configured number of sessions', async () => {
      const service = makeService();

      await expect(service.acquire(GUEST, 's1')).resolves.toBeUndefined();
      await expect(service.acquire(GUEST, 's2')).resolves.toBeUndefined();
    });

    it('refuses the next one with elenaDailyLimit', async () => {
      const service = makeService({ ELENA_CONCURRENT_MAX: '10' });

      await service.acquire(GUEST, 's1');
      await service.acquire(GUEST, 's2');

      expect(await messageKeyOf(service.acquire(GUEST, 's3'))).toBe(
        'elenaDailyLimit',
      );
    });

    it('keys guests by IP, so a fresh guest identity does not reset the cap', async () => {
      // A guest studentId is a throwaway UUID from POST /api/auth/guest. If the
      // cap keyed on it, re-minting a guest token would be a free reset.
      const service = makeService({ ELENA_CONCURRENT_MAX: '10' });

      await service.acquire({ ...GUEST, studentId: 'uuid-a' }, 's1');
      await service.acquire({ ...GUEST, studentId: 'uuid-b' }, 's2');

      expect(
        await messageKeyOf(
          service.acquire({ ...GUEST, studentId: 'uuid-c' }, 's3'),
        ),
      ).toBe('elenaDailyLimit');
    });

    it('keys registered students by studentId, so one NAT does not lock out a class', async () => {
      const service = makeService({ ELENA_CONCURRENT_MAX: '10' });

      await service.acquire(STUDENT, 's1');
      await service.acquire(STUDENT, 's2');
      // Same IP, different student — must still be allowed.
      await expect(
        service.acquire({ ...STUDENT, studentId: 'student-2' }, 's3'),
      ).resolves.toBeUndefined();
    });
  });

  describe('concurrency cap', () => {
    it('refuses with elenaBusyNow once the pool is full', async () => {
      const service = makeService({ ELENA_IP_DAILY_MAX: '99' });

      await service.acquire(GUEST, 's1');
      await service.acquire(GUEST, 's2');

      expect(await messageKeyOf(service.acquire(GUEST, 's3'))).toBe(
        'elenaBusyNow',
      );
    });

    it('frees slots by expiry, with no release call', async () => {
      // The backend never learns that a browser-to-Google session ended, so the
      // pool has to self-heal or it silently fills up forever.
      jest.useFakeTimers();
      try {
        const service = makeService({
          ELENA_IP_DAILY_MAX: '99',
          GEMINI_LIVE_SESSION_MAX_MINUTES: '10',
        });

        await service.acquire(GUEST, 's1');
        await service.acquire(GUEST, 's2');

        jest.advanceTimersByTime(11 * 60 * 1000);

        await expect(service.acquire(GUEST, 's3')).resolves.toBeUndefined();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('a refused caller must not spend shared quota', () => {
    it('lets a capped IP hammer the endpoint without exhausting the global budget', async () => {
      // Regression: acquire() used to consume the global counter before checking
      // the caller's own cap. Because `enforce` cannot refund, one exhausted IP
      // could burn the whole daily budget in ~ELENA_GLOBAL_DAILY_MAX requests
      // and lock every other user out for the day.
      const service = makeService({
        ELENA_IP_DAILY_MAX: '2',
        ELENA_GLOBAL_DAILY_MAX: '10',
        ELENA_CONCURRENT_MAX: '99',
      });

      const attacker = { ip: '6.6.6.6', isGuest: true };
      for (let i = 0; i < 20; i++) {
        await service.acquire(attacker, `a${i}`).catch(() => undefined);
      }

      await expect(
        service.acquire({ ip: '1.1.1.1', isGuest: true }, 'innocent'),
      ).resolves.toBeUndefined();
    });

    it('does not spend a session when the pool is full', async () => {
      // A busy pool is transient. Charging someone one of their two daily
      // sessions for it would be indistinguishable from losing it.
      const service = makeService({
        ELENA_IP_DAILY_MAX: '2',
        ELENA_CONCURRENT_MAX: '1',
      });

      await service.acquire(GUEST, 'holds-the-only-slot');
      expect(await messageKeyOf(service.acquire(GUEST, 'refused'))).toBe(
        'elenaBusyNow',
      );

      // The refusal above cost nothing, so one session remains.
      jest.useFakeTimers();
      try {
        jest.advanceTimersByTime(11 * 60 * 1000);
        await expect(service.acquire(GUEST, 'second')).resolves.toBeUndefined();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('global daily cap', () => {
    it('refuses with elenaBusyToday and does not consume the caller quota', async () => {
      const service = makeService({
        ELENA_GLOBAL_DAILY_MAX: '1',
        ELENA_CONCURRENT_MAX: '10',
      });

      await service.acquire(GUEST, 's1');

      expect(
        await messageKeyOf(service.acquire({ ...GUEST, ip: '9.9.9.9' }, 's2')),
      ).toBe('elenaBusyToday');
    });
  });

  describe('sessionSeconds', () => {
    it('reports the configured session ceiling in seconds', () => {
      expect(makeService().sessionSeconds).toBe(600);
    });
  });
});
