import { Test, TestingModule } from '@nestjs/testing';
import { RoomService } from '../src/modules/speaking/room/room.service';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('RoomService', () => {
  let service: RoomService;

  beforeEach(async () => {
    jest.useFakeTimers();
    const module: TestingModule = await Test.createTestingModule({
      providers: [RoomService],
    }).compile();
    service = module.get<RoomService>(RoomService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ─── createRoom ─────────────────────────────────────────────────────────────

  describe('createRoom()', () => {
    it('returns a UUID roomId', () => {
      const result = service.createRoom();
      expect(result.roomId).toMatch(UUID_PATTERN);
    });

    it('returns a UUID hostToken', () => {
      const result = service.createRoom();
      expect(result.hostToken).toMatch(UUID_PATTERN);
    });

    it('roomId and hostToken are different values', () => {
      const result = service.createRoom();
      expect(result.roomId).not.toBe(result.hostToken);
    });

    it('expiresAt is an ISO string approximately 2 hours from now', () => {
      const before = Date.now();
      const result = service.createRoom();
      const after = Date.now();
      const expiresMs = new Date(result.expiresAt).getTime();
      const twoHoursMs = 2 * 60 * 60 * 1000;
      expect(expiresMs).toBeGreaterThanOrEqual(before + twoHoursMs);
      expect(expiresMs).toBeLessThanOrEqual(after + twoHoursMs + 100);
    });

    it('stores the room so getRoom() finds it', () => {
      const result = service.createRoom();
      const room = service.getRoom(result.roomId);
      expect(room).toBeDefined();
      expect(room!.roomId).toBe(result.roomId);
    });

    it('new room starts with status "waiting"', () => {
      const { roomId } = service.createRoom();
      expect(service.getRoom(roomId)!.status).toBe('waiting');
    });

    it('new room has null hostSocketId and null guest', () => {
      const { roomId } = service.createRoom();
      const room = service.getRoom(roomId)!;
      expect(room.hostSocketId).toBeNull();
      expect(room.guest).toBeNull();
    });
  });

  // ─── getRoom ────────────────────────────────────────────────────────────────

  describe('getRoom()', () => {
    it('returns undefined for an unknown roomId', () => {
      expect(service.getRoom('does-not-exist')).toBeUndefined();
    });
  });

  // ─── verifyHostToken ────────────────────────────────────────────────────────

  describe('verifyHostToken()', () => {
    it('returns true when the token matches', () => {
      const { roomId, hostToken } = service.createRoom();
      expect(service.verifyHostToken(roomId, hostToken)).toBe(true);
    });

    it('returns false when the token is wrong', () => {
      const { roomId } = service.createRoom();
      expect(service.verifyHostToken(roomId, 'wrong-token')).toBe(false);
    });

    it('returns false for an unknown roomId', () => {
      expect(service.verifyHostToken('no-such-room', 'any-token')).toBe(false);
    });
  });

  // ─── setHost ────────────────────────────────────────────────────────────────

  describe('setHost()', () => {
    it('assigns hostSocketId on the room', () => {
      const { roomId } = service.createRoom();
      service.setHost(roomId, 'socket-host-1');
      expect(service.getRoom(roomId)!.hostSocketId).toBe('socket-host-1');
    });

    it('status stays "waiting" when no guest is present', () => {
      const { roomId } = service.createRoom();
      service.setHost(roomId, 'socket-host-1');
      expect(service.getRoom(roomId)!.status).toBe('waiting');
    });

    it('status becomes "active" when a guest is already in the room', () => {
      const { roomId } = service.createRoom();
      service.setGuest(roomId, 'Anna', 'socket-guest-1');
      service.setHost(roomId, 'socket-host-1');
      expect(service.getRoom(roomId)!.status).toBe('active');
    });

    it('is idempotent: second call with same socketId is a no-op', () => {
      const { roomId } = service.createRoom();
      service.setHost(roomId, 'socket-host-1');
      service.setHost(roomId, 'socket-host-1');
      expect(service.getRoom(roomId)!.hostSocketId).toBe('socket-host-1');
    });

    it('is a no-op for an unknown roomId (does not throw)', () => {
      expect(() => service.setHost('unknown', 'socket-1')).not.toThrow();
    });

    it('cancels gracePeriodTimer when host reconnects', () => {
      const { roomId } = service.createRoom();
      service.setGuest(roomId, 'Anna', 'socket-guest-1');
      service.setHost(roomId, 'socket-host-1');

      const onExpire = jest.fn();
      service.startGracePeriod(roomId, onExpire);

      // Host reconnects — should cancel the grace period
      service.setHost(roomId, 'socket-host-2');

      jest.advanceTimersByTime(31_000);
      expect(onExpire).not.toHaveBeenCalled();
    });

    it('revives room to "active" on host reconnect when guest still present', () => {
      const { roomId } = service.createRoom();
      service.setGuest(roomId, 'Anna', 'socket-guest-1');
      service.setHost(roomId, 'socket-host-1');
      service.startGracePeriod(roomId, jest.fn());

      service.setHost(roomId, 'socket-host-2');
      expect(service.getRoom(roomId)!.status).toBe('active');
    });
  });

  // ─── startGracePeriod ───────────────────────────────────────────────────────

  describe('startGracePeriod()', () => {
    it('sets status to "ended" immediately', () => {
      const { roomId } = service.createRoom();
      service.setHost(roomId, 'socket-host-1');
      service.startGracePeriod(roomId, jest.fn());
      expect(service.getRoom(roomId)!.status).toBe('ended');
    });

    it('clears hostSocketId immediately', () => {
      const { roomId } = service.createRoom();
      service.setHost(roomId, 'socket-host-1');
      service.startGracePeriod(roomId, jest.fn());
      expect(service.getRoom(roomId)!.hostSocketId).toBeNull();
    });

    it('calls onExpire with the guest socketId after 30 seconds', () => {
      const { roomId } = service.createRoom();
      service.setGuest(roomId, 'Anna', 'socket-guest-1');
      service.setHost(roomId, 'socket-host-1');

      const onExpire = jest.fn();
      service.startGracePeriod(roomId, onExpire);

      jest.advanceTimersByTime(30_000);
      expect(onExpire).toHaveBeenCalledWith('socket-guest-1');
    });

    it('calls onExpire with null when no guest was present', () => {
      const { roomId } = service.createRoom();
      service.setHost(roomId, 'socket-host-1');

      const onExpire = jest.fn();
      service.startGracePeriod(roomId, onExpire);

      jest.advanceTimersByTime(30_000);
      expect(onExpire).toHaveBeenCalledWith(null);
    });

    it('is a no-op when room does not exist', () => {
      expect(() =>
        service.startGracePeriod('no-room', jest.fn()),
      ).not.toThrow();
    });

    it('is a no-op when status is already "ended"', () => {
      const { roomId } = service.createRoom();
      service.setHost(roomId, 'socket-host-1');
      const firstCallback = jest.fn();
      service.startGracePeriod(roomId, firstCallback);

      const secondCallback = jest.fn();
      service.startGracePeriod(roomId, secondCallback);

      jest.advanceTimersByTime(30_000);
      expect(firstCallback).toHaveBeenCalledTimes(1);
      expect(secondCallback).not.toHaveBeenCalled();
    });
  });

  // ─── setGuest ───────────────────────────────────────────────────────────────

  describe('setGuest()', () => {
    it('assigns guest info', () => {
      const { roomId } = service.createRoom();
      service.setGuest(roomId, 'Anna', 'socket-guest-1');
      const room = service.getRoom(roomId)!;
      expect(room.guest).toEqual({
        displayName: 'Anna',
        socketId: 'socket-guest-1',
      });
    });

    it('status becomes "active" when host is already connected', () => {
      const { roomId } = service.createRoom();
      service.setHost(roomId, 'socket-host-1');
      service.setGuest(roomId, 'Anna', 'socket-guest-1');
      expect(service.getRoom(roomId)!.status).toBe('active');
    });

    it('status stays "waiting" when host is not yet connected', () => {
      const { roomId } = service.createRoom();
      service.setGuest(roomId, 'Anna', 'socket-guest-1');
      expect(service.getRoom(roomId)!.status).toBe('waiting');
    });

    it('is idempotent: same socketId is a no-op', () => {
      const { roomId } = service.createRoom();
      service.setGuest(roomId, 'Anna', 'socket-guest-1');
      service.setGuest(roomId, 'Changed Name', 'socket-guest-1');
      expect(service.getRoom(roomId)!.guest!.displayName).toBe('Anna');
    });

    it('is a no-op for an unknown roomId (does not throw)', () => {
      expect(() =>
        service.setGuest('unknown', 'Anna', 'socket-1'),
      ).not.toThrow();
    });
  });

  // ─── removeGuest ────────────────────────────────────────────────────────────

  describe('removeGuest()', () => {
    it('clears guest info', () => {
      const { roomId } = service.createRoom();
      service.setGuest(roomId, 'Anna', 'socket-guest-1');
      service.removeGuest(roomId);
      expect(service.getRoom(roomId)!.guest).toBeNull();
    });

    it('sets status to "waiting" when not in grace period', () => {
      const { roomId } = service.createRoom();
      service.setHost(roomId, 'socket-host-1');
      service.setGuest(roomId, 'Anna', 'socket-guest-1');
      service.removeGuest(roomId);
      expect(service.getRoom(roomId)!.status).toBe('waiting');
    });

    it('preserves "ended" status during grace period (does not overwrite to "waiting")', () => {
      const { roomId } = service.createRoom();
      service.setGuest(roomId, 'Anna', 'socket-guest-1');
      service.setHost(roomId, 'socket-host-1');
      service.startGracePeriod(roomId, jest.fn());

      service.removeGuest(roomId);
      expect(service.getRoom(roomId)!.status).toBe('ended');
    });

    it('is idempotent: no-op when guest is already null', () => {
      const { roomId } = service.createRoom();
      expect(() => service.removeGuest(roomId)).not.toThrow();
      expect(service.getRoom(roomId)!.guest).toBeNull();
    });

    it('is a no-op for an unknown roomId (does not throw)', () => {
      expect(() => service.removeGuest('unknown')).not.toThrow();
    });
  });

  // ─── deleteRoom ─────────────────────────────────────────────────────────────

  describe('deleteRoom()', () => {
    it('removes the room from the Map', () => {
      const { roomId } = service.createRoom();
      service.deleteRoom(roomId);
      expect(service.getRoom(roomId)).toBeUndefined();
    });

    it('is idempotent: second call does not throw', () => {
      const { roomId } = service.createRoom();
      service.deleteRoom(roomId);
      expect(() => service.deleteRoom(roomId)).not.toThrow();
    });

    it('is a no-op for an unknown roomId (does not throw)', () => {
      expect(() => service.deleteRoom('unknown')).not.toThrow();
    });

    it('clears the gracePeriodTimer so onExpire does not fire after deletion', () => {
      const { roomId } = service.createRoom();
      service.setHost(roomId, 'socket-host-1');
      const onExpire = jest.fn();
      service.startGracePeriod(roomId, onExpire);

      service.deleteRoom(roomId);
      jest.advanceTimersByTime(31_000);
      expect(onExpire).not.toHaveBeenCalled();
    });
  });

  // ─── getRoomBySocketId ──────────────────────────────────────────────────────

  describe('getRoomBySocketId()', () => {
    it('finds the room by host socketId', () => {
      const { roomId } = service.createRoom();
      service.setHost(roomId, 'socket-host-1');
      const found = service.getRoomBySocketId('socket-host-1');
      expect(found?.roomId).toBe(roomId);
    });

    it('finds the room by guest socketId', () => {
      const { roomId } = service.createRoom();
      service.setGuest(roomId, 'Anna', 'socket-guest-1');
      const found = service.getRoomBySocketId('socket-guest-1');
      expect(found?.roomId).toBe(roomId);
    });

    it('returns undefined for an unknown socketId', () => {
      service.createRoom();
      expect(service.getRoomBySocketId('ghost-socket')).toBeUndefined();
    });
  });

  // ─── getAllRooms ─────────────────────────────────────────────────────────────

  describe('getAllRooms()', () => {
    it('returns an iterable containing all created rooms', () => {
      const { roomId: id1 } = service.createRoom();
      const { roomId: id2 } = service.createRoom();
      const ids = [...service.getAllRooms()].map((r) => r.roomId);
      expect(ids).toContain(id1);
      expect(ids).toContain(id2);
    });

    it('returns an empty iterable when no rooms exist', () => {
      expect([...service.getAllRooms()]).toHaveLength(0);
    });
  });
});
