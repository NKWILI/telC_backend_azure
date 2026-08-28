import { LobbyService } from '../src/modules/speaking/room/lobby.service';

function makeService(env: Record<string, string> = {}) {
  const previous = { ...process.env };
  Object.assign(process.env, {
    LOBBY_ENTRY_TTL_SECONDS: '120',
    LOBBY_MAX_SIZE: '200',
    ...env,
  });
  const service = new LobbyService();
  process.env = previous;
  return service;
}

describe('LobbyService', () => {
  describe('enqueue', () => {
    it('queues a socket', () => {
      const lobby = makeService();

      expect(lobby.enqueue('a', 'Anna', 'B1')).toBe('queued');
      expect(lobby.isWaiting('a')).toBe(true);
    });

    it('refuses a second request from the same socket', () => {
      // Otherwise one client could occupy several places in the queue.
      const lobby = makeService();
      lobby.enqueue('a', 'Anna', 'B1');

      expect(lobby.enqueue('a', 'Anna', 'B1')).toBe('already-searching');
    });

    it('refuses once the queue is full', () => {
      const lobby = makeService({ LOBBY_MAX_SIZE: '2' });

      expect(lobby.enqueue('a', 'Anna', 'B1')).toBe('queued');
      expect(lobby.enqueue('b', 'Ben', 'B1')).toBe('queued');
      expect(lobby.enqueue('c', 'Chris', 'B1')).toBe('queue-full');
    });
  });

  describe('findMatch', () => {
    it('returns null when nobody else is waiting', () => {
      // The normal case at demo scale. Not an error.
      const lobby = makeService();
      lobby.enqueue('a', 'Anna', 'B1');

      expect(lobby.findMatch('a')).toBeNull();
    });

    it('never matches a socket with itself', () => {
      const lobby = makeService();
      lobby.enqueue('a', 'Anna', 'B1');

      const match = lobby.findMatch('a');

      expect(match).toBeNull();
      expect(lobby.isWaiting('a')).toBe(true);
    });

    it('pairs two waiting sockets', () => {
      const lobby = makeService();
      lobby.enqueue('a', 'Anna', 'B1');
      lobby.enqueue('b', 'Ben', 'B1');

      const match = lobby.findMatch('b');

      expect(match).not.toBeNull();
      expect([match!.host.socketId, match!.guest.socketId].sort()).toEqual([
        'a',
        'b',
      ]);
    });

    it('makes the longest waiter the host', () => {
      jest.useFakeTimers();
      try {
        const lobby = makeService();
        lobby.enqueue('early', 'Anna', 'B1');
        jest.advanceTimersByTime(5_000);
        lobby.enqueue('late', 'Ben', 'B1');

        const match = lobby.findMatch('late');

        expect(match!.host.socketId).toBe('early');
        expect(match!.guest.socketId).toBe('late');
      } finally {
        jest.useRealTimers();
      }
    });

    it('serves the longest waiter first when several are queued', () => {
      jest.useFakeTimers();
      try {
        const lobby = makeService();
        lobby.enqueue('first', 'Anna', 'B1');
        jest.advanceTimersByTime(1_000);
        lobby.enqueue('second', 'Ben', 'B1');
        jest.advanceTimersByTime(1_000);
        lobby.enqueue('third', 'Chris', 'B1');

        const match = lobby.findMatch('third');

        // FIFO: 'first' has waited longest and gets served, not 'second'.
        expect(match!.host.socketId).toBe('first');
        expect(lobby.isWaiting('second')).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });

    it('removes both from the queue at match time', () => {
      // A client slow to act on partner-found must not be matched again, or one
      // person ends up waiting in a room nobody is coming to.
      const lobby = makeService();
      lobby.enqueue('a', 'Anna', 'B1');
      lobby.enqueue('b', 'Ben', 'B1');

      lobby.findMatch('b');

      expect(lobby.isWaiting('a')).toBe(false);
      expect(lobby.isWaiting('b')).toBe(false);
      expect(lobby.countWaiting()).toBe(0);
    });

    it('returns null for a socket that is not queued', () => {
      const lobby = makeService();
      lobby.enqueue('a', 'Anna', 'B1');

      expect(lobby.findMatch('never-queued')).toBeNull();
    });
  });

  describe('dequeue', () => {
    it('removes a waiting socket', () => {
      const lobby = makeService();
      lobby.enqueue('a', 'Anna', 'B1');

      expect(lobby.dequeue('a')).toBe(true);
      expect(lobby.isWaiting('a')).toBe(false);
    });

    it('is idempotent and safe on an unknown socket', () => {
      const lobby = makeService();

      expect(lobby.dequeue('ghost')).toBe(false);
      expect(lobby.dequeue('ghost')).toBe(false);
    });
  });

  describe('countWaiting', () => {
    it('excludes the asker, so a lone student is told zero', () => {
      // Reporting "1 waiting" to the only person queued would promise a match
      // that cannot happen.
      const lobby = makeService();
      lobby.enqueue('a', 'Anna', 'B1');

      expect(lobby.countWaiting('a')).toBe(0);
      expect(lobby.countWaiting()).toBe(1);
    });

    it('counts the others', () => {
      const lobby = makeService();
      lobby.enqueue('a', 'Anna', 'B1');
      lobby.enqueue('b', 'Ben', 'B1');
      lobby.enqueue('c', 'Chris', 'B1');

      expect(lobby.countWaiting('a')).toBe(2);
    });

    it('counts only people at the asker’s own level', () => {
      // Inert while B1 is the only level, and the reason it is written now: a
      // cross-level count would quietly start lying the day a second level is
      // seeded, and nothing would fail to reveal it.
      const lobby = makeService();
      lobby.enqueue('a', 'Anna', 'B1');
      lobby.enqueue('b', 'Ben', 'B1');
      lobby.enqueue('c', 'Chris', 'A2' as never);

      expect(lobby.countWaiting('a')).toBe(1);
    });
  });

  describe('stale entries', () => {
    it('are not offered as a partner', () => {
      // A closed laptop leaves no disconnect. Matching against it would put a
      // student in a room nobody joins.
      jest.useFakeTimers();
      try {
        const lobby = makeService({ LOBBY_ENTRY_TTL_SECONDS: '120' });
        lobby.enqueue('ghost', 'Anna', 'B1');

        jest.advanceTimersByTime(121_000);
        lobby.enqueue('live', 'Ben', 'B1');

        expect(lobby.findMatch('live')).toBeNull();
        expect(lobby.isWaiting('ghost')).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    it('do not count toward the waiting total', () => {
      jest.useFakeTimers();
      try {
        const lobby = makeService({ LOBBY_ENTRY_TTL_SECONDS: '60' });
        lobby.enqueue('ghost', 'Anna', 'B1');
        jest.advanceTimersByTime(61_000);

        expect(lobby.countWaiting()).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });

    it('free up room in a full queue', () => {
      jest.useFakeTimers();
      try {
        const lobby = makeService({
          LOBBY_MAX_SIZE: '1',
          LOBBY_ENTRY_TTL_SECONDS: '60',
        });
        lobby.enqueue('ghost', 'Anna', 'B1');
        expect(lobby.enqueue('blocked', 'Ben', 'B1')).toBe('queue-full');

        jest.advanceTimersByTime(61_000);

        expect(lobby.enqueue('live', 'Chris', 'B1')).toBe('queued');
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('waitingSocketIds', () => {
    it('lists everyone still queued, for broadcasting a changed count', () => {
      const lobby = makeService();
      lobby.enqueue('a', 'Anna', 'B1');
      lobby.enqueue('b', 'Ben', 'B1');

      expect(lobby.waitingSocketIds().sort()).toEqual(['a', 'b']);
    });
  });
});
