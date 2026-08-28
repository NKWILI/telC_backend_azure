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
    hostSocketId: null,
    hostToken: HOST_TOKEN,
    guest: null,
    status: 'waiting',
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

describe('RoomGateway', () => {
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
      | 'selectNextTopic'
    >
  >;
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
      selectNextTopic: jest.fn(),
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

    // Inject mock server
    mockTo = jest.fn();
    gateway.server = { to: mockTo.mockReturnValue({ emit: jest.fn() }) } as any;
  });

  describe('handleShuffleTopic()', () => {
    it('updates the topic and emits the same payload to host and guest', () => {
      const room = makeRoom({
        hostSocketId: HOST_SOCKET_ID,
        guest: { displayName: 'Anna', socketId: GUEST_SOCKET_ID },
      });
      const nextTopic = SPEAKING_TOPICS[1];
      const targetEmit = jest.fn();
      roomService.getRoom.mockReturnValue(room);
      roomService.selectNextTopic.mockReturnValue(nextTopic);
      mockTo.mockReturnValue({ emit: targetEmit });

      gateway.handleShuffleTopic(makeClient(HOST_SOCKET_ID, ROOM_ID), {
        roomId: ROOM_ID,
      });

      expect(roomService.selectNextTopic).toHaveBeenCalledWith(ROOM_ID);
      expect(mockTo).toHaveBeenCalledWith(HOST_SOCKET_ID);
      expect(mockTo).toHaveBeenCalledWith(GUEST_SOCKET_ID);
      expect(targetEmit).toHaveBeenCalledTimes(2);
      expect(targetEmit).toHaveBeenNthCalledWith(1, 'topic-changed', {
        topic: nextTopic,
      });
      expect(targetEmit).toHaveBeenNthCalledWith(2, 'topic-changed', {
        topic: nextTopic,
      });
    });

    it('emits to the host when no guest is connected', () => {
      const room = makeRoom({ hostSocketId: HOST_SOCKET_ID, guest: null });
      const targetEmit = jest.fn();
      roomService.getRoom.mockReturnValue(room);
      roomService.selectNextTopic.mockReturnValue(SPEAKING_TOPICS[1]);
      mockTo.mockReturnValue({ emit: targetEmit });

      gateway.handleShuffleTopic(makeClient(HOST_SOCKET_ID, ROOM_ID), {
        roomId: ROOM_ID,
      });

      expect(mockTo).toHaveBeenCalledTimes(1);
      expect(mockTo).toHaveBeenCalledWith(HOST_SOCKET_ID);
      expect(targetEmit).toHaveBeenCalledWith('topic-changed', {
        topic: SPEAKING_TOPICS[1],
      });
    });

    it('rejects a guest without selecting another topic', () => {
      const room = makeRoom({
        hostSocketId: HOST_SOCKET_ID,
        guest: { displayName: 'Anna', socketId: GUEST_SOCKET_ID },
      });
      const client = makeClient(GUEST_SOCKET_ID, ROOM_ID);
      roomService.getRoom.mockReturnValue(room);

      gateway.handleShuffleTopic(client, { roomId: ROOM_ID });

      expect(client.emit).toHaveBeenCalledWith('unauthorized', {});
      expect(roomService.selectNextTopic).not.toHaveBeenCalled();
      expect(mockTo).not.toHaveBeenCalled();
    });

    it('rejects a host socket associated with another room', () => {
      const room = makeRoom({ hostSocketId: HOST_SOCKET_ID });
      const client = makeClient(HOST_SOCKET_ID, 'another-room');
      roomService.getRoom.mockReturnValue(room);

      gateway.handleShuffleTopic(client, { roomId: ROOM_ID });

      expect(client.emit).toHaveBeenCalledWith('unauthorized', {});
      expect(roomService.selectNextTopic).not.toHaveBeenCalled();
    });

    it('emits room-not-found without selecting when the room is missing', () => {
      const client = makeClient(HOST_SOCKET_ID, ROOM_ID);
      roomService.getRoom.mockReturnValue(undefined);

      gateway.handleShuffleTopic(client, { roomId: ROOM_ID });

      expect(client.emit).toHaveBeenCalledWith('room-not-found', {});
      expect(roomService.selectNextTopic).not.toHaveBeenCalled();
    });
  });

  afterEach(() => jest.clearAllMocks());

  // ─── join-room ─────────────────────────────────────────────────────────────

  describe('handleJoinRoom()', () => {
    it('is a no-op when socket is already in the same room (EDGE-06 idempotent)', () => {
      const client = makeClient(HOST_SOCKET_ID, ROOM_ID);
      gateway.handleJoinRoom(client, { roomId: ROOM_ID, displayName: 'Anna' });
      expect(roomService.getRoom).not.toHaveBeenCalled();
    });

    it('emits already-in-room when socket tries a different room (EDGE-06)', () => {
      const client = makeClient(HOST_SOCKET_ID, 'different-room');
      gateway.handleJoinRoom(client, { roomId: ROOM_ID, displayName: 'Anna' });
      expect(client.emit).toHaveBeenCalledWith('already-in-room', {});
    });

    it('emits room-not-found when room does not exist (EDGE-02)', () => {
      roomService.getRoom.mockReturnValue(undefined);
      const client = makeClient(HOST_SOCKET_ID);
      gateway.handleJoinRoom(client, { roomId: ROOM_ID, displayName: 'Anna' });
      expect(client.emit).toHaveBeenCalledWith('room-not-found', {});
    });

    describe('host path (token matches)', () => {
      it('calls setHost and stores roomId on client.data', () => {
        const room = makeRoom();
        roomService.getRoom.mockReturnValue(room);
        roomService.verifyHostToken.mockReturnValue(true);
        const client = makeClient(HOST_SOCKET_ID);

        gateway.handleJoinRoom(client, {
          roomId: ROOM_ID,
          displayName: 'Host',
          hostToken: HOST_TOKEN,
        });

        expect(roomService.setHost).toHaveBeenCalledWith(
          ROOM_ID,
          HOST_SOCKET_ID,
        );
        expect(client.data.roomId).toBe(ROOM_ID);
      });

      it('emits guest-joined to host when a guest is already in the room (RC-01)', () => {
        const room = makeRoom({
          guest: { displayName: 'Anna', socketId: GUEST_SOCKET_ID },
        });
        roomService.getRoom.mockReturnValue(room);
        roomService.verifyHostToken.mockReturnValue(true);
        const client = makeClient(HOST_SOCKET_ID);

        gateway.handleJoinRoom(client, {
          roomId: ROOM_ID,
          displayName: 'Host',
          hostToken: HOST_TOKEN,
        });

        expect(client.emit).toHaveBeenCalledWith('guest-joined', {
          displayName: 'Anna',
        });
      });

      it('does NOT emit guest-joined when no guest in room', () => {
        const room = makeRoom({ guest: null });
        roomService.getRoom.mockReturnValue(room);
        roomService.verifyHostToken.mockReturnValue(true);
        const client = makeClient(HOST_SOCKET_ID);

        gateway.handleJoinRoom(client, {
          roomId: ROOM_ID,
          displayName: 'Host',
          hostToken: HOST_TOKEN,
        });

        expect(client.emit).not.toHaveBeenCalledWith(
          'guest-joined',
          expect.anything(),
        );
      });
    });

    describe('guest path (no token or wrong token)', () => {
      it('emits room-full when a guest is already in the room (RC-02)', () => {
        const room = makeRoom({
          guest: { displayName: 'Other', socketId: 'other-socket' },
        });
        roomService.getRoom.mockReturnValue(room);
        roomService.verifyHostToken.mockReturnValue(false);
        const client = makeClient(GUEST_SOCKET_ID);

        gateway.handleJoinRoom(client, {
          roomId: ROOM_ID,
          displayName: 'Anna',
        });

        expect(client.emit).toHaveBeenCalledWith('room-full', {});
        expect(roomService.setGuest).not.toHaveBeenCalled();
      });

      it('calls setGuest and stores roomId on client.data', () => {
        const room = makeRoom({ guest: null });
        roomService.getRoom.mockReturnValue(room);
        roomService.verifyHostToken.mockReturnValue(false);
        const client = makeClient(GUEST_SOCKET_ID);

        gateway.handleJoinRoom(client, {
          roomId: ROOM_ID,
          displayName: 'Anna',
        });

        expect(roomService.setGuest).toHaveBeenCalledWith(
          ROOM_ID,
          'Anna',
          GUEST_SOCKET_ID,
        );
        expect(client.data.roomId).toBe(ROOM_ID);
      });

      it('emits guest-joined to host socket when host is already connected', () => {
        const room = makeRoom({ hostSocketId: HOST_SOCKET_ID, guest: null });
        roomService.getRoom.mockReturnValue(room);
        roomService.verifyHostToken.mockReturnValue(false);
        const client = makeClient(GUEST_SOCKET_ID);
        const hostEmit = jest.fn();
        mockTo.mockReturnValue({ emit: hostEmit });

        gateway.handleJoinRoom(client, {
          roomId: ROOM_ID,
          displayName: 'Anna',
        });

        expect(mockTo).toHaveBeenCalledWith(HOST_SOCKET_ID);
        expect(hostEmit).toHaveBeenCalledWith('guest-joined', {
          displayName: 'Anna',
        });
      });

      it('stores guest silently when host is not yet connected (RC-01)', () => {
        const room = makeRoom({ hostSocketId: null, guest: null });
        roomService.getRoom.mockReturnValue(room);
        roomService.verifyHostToken.mockReturnValue(false);
        const client = makeClient(GUEST_SOCKET_ID);

        gateway.handleJoinRoom(client, {
          roomId: ROOM_ID,
          displayName: 'Anna',
        });

        expect(roomService.setGuest).toHaveBeenCalled();
        expect(mockTo).not.toHaveBeenCalled();
      });
    });
  });

  // ─── offer ────────────────────────────────────────────────────────────────

  describe('handleOffer()', () => {
    const offerPayload = {
      type: 'offer',
      sdp: 'v=0...',
    } as RTCSessionDescriptionInit;

    it('emits room-not-found when room does not exist (EDGE-02)', () => {
      roomService.getRoom.mockReturnValue(undefined);
      const client = makeClient(HOST_SOCKET_ID);

      gateway.handleOffer(client, { roomId: ROOM_ID, offer: offerPayload });

      expect(client.emit).toHaveBeenCalledWith('room-not-found', {});
    });

    it('emits unauthorized when sender is not the host (SEC-03)', () => {
      const room = makeRoom({ hostSocketId: HOST_SOCKET_ID });
      roomService.getRoom.mockReturnValue(room);
      const client = makeClient('not-the-host');

      gateway.handleOffer(client, { roomId: ROOM_ID, offer: offerPayload });

      expect(client.emit).toHaveBeenCalledWith('unauthorized', {});
    });

    it('emits no-guest-ready when guest is null (EDGE-01)', () => {
      const room = makeRoom({ hostSocketId: HOST_SOCKET_ID, guest: null });
      roomService.getRoom.mockReturnValue(room);
      const client = makeClient(HOST_SOCKET_ID);

      gateway.handleOffer(client, { roomId: ROOM_ID, offer: offerPayload });

      expect(client.emit).toHaveBeenCalledWith('no-guest-ready', {});
    });

    it('forwards offer to guest socket when valid', () => {
      const room = makeRoom({
        hostSocketId: HOST_SOCKET_ID,
        guest: { displayName: 'Anna', socketId: GUEST_SOCKET_ID },
      });
      roomService.getRoom.mockReturnValue(room);
      const client = makeClient(HOST_SOCKET_ID);
      const guestEmit = jest.fn();
      mockTo.mockReturnValue({ emit: guestEmit });

      gateway.handleOffer(client, { roomId: ROOM_ID, offer: offerPayload });

      expect(mockTo).toHaveBeenCalledWith(GUEST_SOCKET_ID);
      expect(guestEmit).toHaveBeenCalledWith('offer', { offer: offerPayload });
    });
  });

  // ─── answer ───────────────────────────────────────────────────────────────

  describe('handleAnswer()', () => {
    const answerPayload = {
      type: 'answer',
      sdp: 'v=0...',
    } as RTCSessionDescriptionInit;

    it('emits room-not-found when room does not exist (EDGE-02)', () => {
      roomService.getRoom.mockReturnValue(undefined);
      const client = makeClient(GUEST_SOCKET_ID);

      gateway.handleAnswer(client, { roomId: ROOM_ID, answer: answerPayload });

      expect(client.emit).toHaveBeenCalledWith('room-not-found', {});
    });

    it('emits unauthorized when sender is not the guest (SEC-03)', () => {
      const room = makeRoom({
        guest: { displayName: 'Anna', socketId: GUEST_SOCKET_ID },
      });
      roomService.getRoom.mockReturnValue(room);
      const client = makeClient('not-the-guest');

      gateway.handleAnswer(client, { roomId: ROOM_ID, answer: answerPayload });

      expect(client.emit).toHaveBeenCalledWith('unauthorized', {});
    });

    it('forwards answer to host socket when valid', () => {
      const room = makeRoom({
        hostSocketId: HOST_SOCKET_ID,
        guest: { displayName: 'Anna', socketId: GUEST_SOCKET_ID },
      });
      roomService.getRoom.mockReturnValue(room);
      const client = makeClient(GUEST_SOCKET_ID);
      const hostEmit = jest.fn();
      mockTo.mockReturnValue({ emit: hostEmit });

      gateway.handleAnswer(client, { roomId: ROOM_ID, answer: answerPayload });

      expect(mockTo).toHaveBeenCalledWith(HOST_SOCKET_ID);
      expect(hostEmit).toHaveBeenCalledWith('answer', {
        answer: answerPayload,
      });
    });
  });

  // ─── ice-candidate ────────────────────────────────────────────────────────

  describe('handleIceCandidate()', () => {
    const candidate = {
      candidate: 'candidate:...',
      sdpMid: '0',
      sdpMLineIndex: 0,
    } as RTCIceCandidateInit;

    it('emits room-not-found when room does not exist (EDGE-02)', () => {
      roomService.getRoom.mockReturnValue(undefined);
      const client = makeClient(HOST_SOCKET_ID);

      gateway.handleIceCandidate(client, { roomId: ROOM_ID, candidate });

      expect(client.emit).toHaveBeenCalledWith('room-not-found', {});
    });

    it('forwards candidate to guest when sender is host', () => {
      const room = makeRoom({
        hostSocketId: HOST_SOCKET_ID,
        guest: { displayName: 'Anna', socketId: GUEST_SOCKET_ID },
      });
      roomService.getRoom.mockReturnValue(room);
      const client = makeClient(HOST_SOCKET_ID);
      const targetEmit = jest.fn();
      mockTo.mockReturnValue({ emit: targetEmit });

      gateway.handleIceCandidate(client, { roomId: ROOM_ID, candidate });

      expect(mockTo).toHaveBeenCalledWith(GUEST_SOCKET_ID);
      expect(targetEmit).toHaveBeenCalledWith('ice-candidate', { candidate });
    });

    it('forwards candidate to host when sender is guest', () => {
      const room = makeRoom({
        hostSocketId: HOST_SOCKET_ID,
        guest: { displayName: 'Anna', socketId: GUEST_SOCKET_ID },
      });
      roomService.getRoom.mockReturnValue(room);
      const client = makeClient(GUEST_SOCKET_ID);
      const targetEmit = jest.fn();
      mockTo.mockReturnValue({ emit: targetEmit });

      gateway.handleIceCandidate(client, { roomId: ROOM_ID, candidate });

      expect(mockTo).toHaveBeenCalledWith(HOST_SOCKET_ID);
      expect(targetEmit).toHaveBeenCalledWith('ice-candidate', { candidate });
    });

    it('discards silently when sender is neither host nor guest', () => {
      const room = makeRoom({
        hostSocketId: HOST_SOCKET_ID,
        guest: { displayName: 'Anna', socketId: GUEST_SOCKET_ID },
      });
      roomService.getRoom.mockReturnValue(room);
      const client = makeClient('unknown-socket');

      gateway.handleIceCandidate(client, { roomId: ROOM_ID, candidate });

      expect(mockTo).not.toHaveBeenCalled();
      expect(client.emit).not.toHaveBeenCalled();
    });

    it('discards silently when target socket is null', () => {
      const room = makeRoom({ hostSocketId: HOST_SOCKET_ID, guest: null });
      roomService.getRoom.mockReturnValue(room);
      const client = makeClient(HOST_SOCKET_ID);

      gateway.handleIceCandidate(client, { roomId: ROOM_ID, candidate });

      expect(mockTo).not.toHaveBeenCalled();
    });
  });
});
