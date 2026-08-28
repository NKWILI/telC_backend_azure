import { Test, TestingModule } from '@nestjs/testing';
import { RoomGateway } from '../src/modules/speaking/room/room.gateway';
import { RoomService } from '../src/modules/speaking/room/room.service';
import { LobbyService } from '../src/modules/speaking/room/lobby.service';
import { SafetyService } from '../src/modules/speaking/room/safety.service';
import { Room } from '../src/modules/speaking/room/interfaces/room.interface';
import { SPEAKING_TOPICS } from '../src/modules/speaking/room/speaking-topics.data';

// ─── helpers ────────────────────────────────────────────────────────────────

const ROOM_ID = 'room-uuid-1';
const HOST_TOKEN = 'host-token-secret';
const HOST_SOCKET_ID = 'socket-host-1';
const GUEST_SOCKET_ID = 'socket-guest-1';

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    roomId: ROOM_ID,
    level: 'B1',
    topic: SPEAKING_TOPICS[0],
    usedTopicIds: [SPEAKING_TOPICS[0].id],
    hostSocketId: HOST_SOCKET_ID,
    hostToken: HOST_TOKEN,
    guest: { displayName: 'Anna', socketId: GUEST_SOCKET_ID },
    status: 'active',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 7_200_000),
    expiryTimer: null as any,
    gracePeriodTimer: null,
    ...overrides,
  };
}

function makeClient(id: string, roomId?: string) {
  return {
    id,
    emit: jest.fn(),
    data: { roomId } as Record<string, unknown>,
  } as any;
}

// ─── spec ────────────────────────────────────────────────────────────────────

describe('RoomGateway — disconnect & leave (Task 6)', () => {
  let gateway: RoomGateway;
  let roomService: jest.Mocked<
    Pick<
      RoomService,
      | 'getRoom'
      | 'verifyHostToken'
      | 'setHost'
      | 'setGuest'
      | 'deleteRoom'
      | 'removeGuest'
      | 'startGracePeriod'
      | 'getRoomBySocketId'
      | 'getAllRooms'
    >
  >;
  let mockEmit: jest.Mock;
  let mockTo: jest.Mock;

  beforeEach(async () => {
    roomService = {
      getRoom: jest.fn(),
      verifyHostToken: jest.fn(),
      setHost: jest.fn(),
      setGuest: jest.fn(),
      deleteRoom: jest.fn(),
      removeGuest: jest.fn(),
      startGracePeriod: jest.fn(),
      getRoomBySocketId: jest.fn(),
      getAllRooms: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomGateway,
        { provide: RoomService, useValue: roomService },
        // Real instance: pure in-memory state, no dependencies, and these specs
        // exercise paths that legitimately touch the queue on disconnect.
        LobbyService,
        SafetyService,
      ],
    }).compile();

    gateway = module.get<RoomGateway>(RoomGateway);
    mockEmit = jest.fn();
    mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
    gateway.server = { to: mockTo, sockets: new Map() } as any;
  });

  afterEach(() => jest.clearAllMocks());

  // ─── leave-room ────────────────────────────────────────────────────────────

  describe('handleLeaveRoom()', () => {
    it('is a silent no-op when socket is not in any room', () => {
      roomService.getRoomBySocketId.mockReturnValue(undefined);
      const client = makeClient('orphan-socket');

      gateway.handleLeaveRoom(client);

      expect(roomService.deleteRoom).not.toHaveBeenCalled();
      expect(roomService.removeGuest).not.toHaveBeenCalled();
      expect(mockTo).not.toHaveBeenCalled();
    });

    it('host leaves: emits room-ended to guest and calls deleteRoom', () => {
      const room = makeRoom();
      roomService.getRoomBySocketId.mockReturnValue(room);
      const client = makeClient(HOST_SOCKET_ID, ROOM_ID);

      gateway.handleLeaveRoom(client);

      expect(mockTo).toHaveBeenCalledWith(GUEST_SOCKET_ID);
      expect(mockEmit).toHaveBeenCalledWith('room-ended', {});
      expect(roomService.deleteRoom).toHaveBeenCalledWith(ROOM_ID);
    });

    it('host leaves with no guest: calls deleteRoom without emitting', () => {
      const room = makeRoom({ guest: null });
      roomService.getRoomBySocketId.mockReturnValue(room);
      const client = makeClient(HOST_SOCKET_ID, ROOM_ID);

      gateway.handleLeaveRoom(client);

      expect(mockTo).not.toHaveBeenCalled();
      expect(roomService.deleteRoom).toHaveBeenCalledWith(ROOM_ID);
    });

    it('guest leaves: emits partner-left to host and calls removeGuest', () => {
      const room = makeRoom();
      roomService.getRoomBySocketId.mockReturnValue(room);
      const client = makeClient(GUEST_SOCKET_ID, ROOM_ID);

      gateway.handleLeaveRoom(client);

      expect(mockTo).toHaveBeenCalledWith(HOST_SOCKET_ID);
      expect(mockEmit).toHaveBeenCalledWith('partner-left', {});
      expect(roomService.removeGuest).toHaveBeenCalledWith(ROOM_ID);
      expect(roomService.deleteRoom).not.toHaveBeenCalled();
    });

    it('guest leaves with no host: calls removeGuest without emitting', () => {
      const room = makeRoom({ hostSocketId: null });
      roomService.getRoomBySocketId.mockReturnValue(room);
      const client = makeClient(GUEST_SOCKET_ID, ROOM_ID);

      gateway.handleLeaveRoom(client);

      expect(mockTo).not.toHaveBeenCalled();
      expect(roomService.removeGuest).toHaveBeenCalledWith(ROOM_ID);
    });
  });

  // ─── handleDisconnect ──────────────────────────────────────────────────────

  describe('handleDisconnect()', () => {
    it('does nothing when socket is not in any room', () => {
      roomService.getRoomBySocketId.mockReturnValue(undefined);
      const client = makeClient('orphan-socket');

      gateway.handleDisconnect(client);

      expect(roomService.startGracePeriod).not.toHaveBeenCalled();
      expect(roomService.removeGuest).not.toHaveBeenCalled();
    });

    it('host disconnect: calls startGracePeriod and emits host-disconnected to guest', () => {
      const room = makeRoom();
      roomService.getRoomBySocketId.mockReturnValue(room);
      const client = makeClient(HOST_SOCKET_ID); // no data.roomId → fallback path

      gateway.handleDisconnect(client);

      expect(roomService.startGracePeriod).toHaveBeenCalledWith(
        ROOM_ID,
        expect.any(Function),
      );
      expect(mockTo).toHaveBeenCalledWith(GUEST_SOCKET_ID);
      expect(mockEmit).toHaveBeenCalledWith('host-disconnected', {});
    });

    it('host disconnect with no guest: calls startGracePeriod without emitting', () => {
      const room = makeRoom({ guest: null });
      roomService.getRoomBySocketId.mockReturnValue(room);
      const client = makeClient(HOST_SOCKET_ID); // no data.roomId → fallback path

      gateway.handleDisconnect(client);

      expect(roomService.startGracePeriod).toHaveBeenCalled();
      expect(mockTo).not.toHaveBeenCalled();
    });

    it('grace period fires: emits room-ended to guest and calls deleteRoom', () => {
      const room = makeRoom();
      roomService.getRoomBySocketId.mockReturnValue(room);
      const client = makeClient(HOST_SOCKET_ID); // no data.roomId → fallback path

      roomService.startGracePeriod.mockImplementation((_roomId, onExpire) => {
        onExpire(GUEST_SOCKET_ID); // simulate timer firing
      });

      gateway.handleDisconnect(client);

      expect(mockTo).toHaveBeenCalledWith(GUEST_SOCKET_ID);
      expect(mockEmit).toHaveBeenCalledWith('room-ended', {});
      expect(roomService.deleteRoom).toHaveBeenCalledWith(ROOM_ID);
    });

    it('grace period fires with null guestSocketId: calls deleteRoom without emitting', () => {
      const room = makeRoom({ guest: null });
      roomService.getRoomBySocketId.mockReturnValue(room);
      const client = makeClient(HOST_SOCKET_ID); // no data.roomId → fallback path

      roomService.startGracePeriod.mockImplementation((_roomId, onExpire) => {
        onExpire(null);
      });

      gateway.handleDisconnect(client);

      expect(roomService.deleteRoom).toHaveBeenCalledWith(ROOM_ID);
      // room-ended not emitted since guestSocketId is null
      const roomEndedEmits = mockEmit.mock.calls.filter(
        ([event]) => event === 'room-ended',
      );
      expect(roomEndedEmits).toHaveLength(0);
    });

    it('guest disconnect: emits partner-left to host and calls removeGuest', () => {
      const room = makeRoom();
      roomService.getRoomBySocketId.mockReturnValue(room);
      const client = makeClient(GUEST_SOCKET_ID); // no data.roomId → fallback path

      gateway.handleDisconnect(client);

      expect(mockTo).toHaveBeenCalledWith(HOST_SOCKET_ID);
      expect(mockEmit).toHaveBeenCalledWith('partner-left', {});
      expect(roomService.removeGuest).toHaveBeenCalledWith(ROOM_ID);
    });

    it('uses client.data.roomId for O(1) lookup when available', () => {
      const room = makeRoom();
      roomService.getRoom.mockReturnValue(room);
      const client = makeClient(HOST_SOCKET_ID, ROOM_ID); // has data.roomId set

      gateway.handleDisconnect(client);

      expect(roomService.getRoom).toHaveBeenCalledWith(ROOM_ID);
      expect(roomService.getRoomBySocketId).not.toHaveBeenCalled();
    });

    it('falls back to getRoomBySocketId when client.data.roomId is unset', () => {
      const room = makeRoom();
      roomService.getRoomBySocketId.mockReturnValue(room);
      const client = makeClient(HOST_SOCKET_ID); // no data.roomId

      gateway.handleDisconnect(client);

      expect(roomService.getRoomBySocketId).toHaveBeenCalledWith(
        HOST_SOCKET_ID,
      );
    });
  });

  // ─── join-room reconnect path (RC-03) ─────────────────────────────────────

  describe('handleJoinRoom() — host reconnect (RC-03)', () => {
    it('emits host-reconnected to guest when host reconnects during grace period', () => {
      const room = makeRoom({ hostSocketId: null, status: 'ended' });
      roomService.getRoom.mockReturnValue(room);
      roomService.verifyHostToken.mockReturnValue(true);
      const client = makeClient('socket-host-2');

      gateway.handleJoinRoom(client, {
        roomId: ROOM_ID,
        displayName: 'Host',
        hostToken: HOST_TOKEN,
      });

      expect(mockTo).toHaveBeenCalledWith(GUEST_SOCKET_ID);
      expect(mockEmit).toHaveBeenCalledWith('host-reconnected', {});
    });

    it('does NOT emit guest-joined when reconnecting (only host-reconnected)', () => {
      const room = makeRoom({ hostSocketId: null, status: 'ended' });
      roomService.getRoom.mockReturnValue(room);
      roomService.verifyHostToken.mockReturnValue(true);
      const client = makeClient('socket-host-2');

      gateway.handleJoinRoom(client, {
        roomId: ROOM_ID,
        displayName: 'Host',
        hostToken: HOST_TOKEN,
      });

      const guestJoinedCalls = client.emit.mock.calls.filter(
        ([e]) => e === 'guest-joined',
      );
      expect(guestJoinedCalls).toHaveLength(0);
    });
  });

  // ─── onApplicationShutdown ─────────────────────────────────────────────────

  describe('onApplicationShutdown()', () => {
    it('emits server-shutting-down to every connected socket across all rooms', () => {
      const room1 = makeRoom();
      const room2 = makeRoom({
        roomId: 'room-2',
        hostSocketId: 'host-2',
        guest: { displayName: 'Bob', socketId: 'guest-2' },
      });
      roomService.getAllRooms.mockReturnValue(
        [room1, room2][Symbol.iterator]() as any,
      );

      gateway.onApplicationShutdown('SIGTERM');

      const targetIds = mockTo.mock.calls.map(([id]) => id);
      expect(targetIds).toContain(HOST_SOCKET_ID);
      expect(targetIds).toContain(GUEST_SOCKET_ID);
      expect(targetIds).toContain('host-2');
      expect(targetIds).toContain('guest-2');
      expect(mockEmit).toHaveBeenCalledWith('server-shutting-down', {});
    });

    it('skips null socket slots without throwing', () => {
      const room = makeRoom({ guest: null });
      roomService.getAllRooms.mockReturnValue([room][Symbol.iterator]() as any);

      expect(() => gateway.onApplicationShutdown('SIGTERM')).not.toThrow();
      expect(mockTo).toHaveBeenCalledWith(HOST_SOCKET_ID);
    });
  });
});
