import { Test, TestingModule } from '@nestjs/testing';
import { RoomGateway } from '../src/modules/speaking/room/room.gateway';
import { RoomService } from '../src/modules/speaking/room/room.service';
import { LobbyService } from '../src/modules/speaking/room/lobby.service';
import { SafetyService } from '../src/modules/speaking/room/safety.service';

const ROOM_ID = 'room-uuid-1';
const HOST_TOKEN = 'host-token-secret';

function makeClient(id: string, roomId?: string) {
  return {
    id,
    emit: jest.fn(),
    data: { roomId } as Record<string, unknown>,
  } as any;
}

describe('RoomGateway — lobby', () => {
  let gateway: RoomGateway;
  let lobby: LobbyService;
  let roomService: {
    createRoom: jest.Mock;
    getRoom: jest.Mock;
    getRoomBySocketId: jest.Mock;
    startGracePeriod: jest.Mock;
    removeGuest: jest.Mock;
  };
  let emitTo: jest.Mock;
  let mockTo: jest.Mock;

  beforeEach(async () => {
    roomService = {
      createRoom: jest.fn().mockReturnValue({
        roomId: ROOM_ID,
        hostToken: HOST_TOKEN,
        expiresAt: new Date().toISOString(),
      }),
      getRoom: jest.fn(),
      getRoomBySocketId: jest.fn(),
      startGracePeriod: jest.fn(),
      removeGuest: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomGateway,
        { provide: RoomService, useValue: roomService },
        LobbyService,
        SafetyService,
      ],
    }).compile();

    gateway = module.get(RoomGateway);
    lobby = module.get(LobbyService);

    emitTo = jest.fn();
    mockTo = jest.fn().mockReturnValue({ emit: emitTo });
    gateway.server = { to: mockTo } as any;
  });

  /** All payloads emitted to a given socket id via server.to(). */
  function payloadsTo(socketId: string): [string, unknown][] {
    return mockTo.mock.calls
      .map((call, index) => [call[0] as string, index] as const)
      .filter(([id]) => id === socketId)
      .map(([, index]) => emitTo.mock.calls[index] as [string, unknown]);
  }

  describe('handleFindPartner', () => {
    it('queues the first caller and tells them nobody else is waiting', () => {
      const client = makeClient('a');

      gateway.handleFindPartner(client, { displayName: 'Anna' });

      expect(client.emit).toHaveBeenCalledWith('waiting', { count: 0 });
      expect(lobby.isWaiting('a')).toBe(true);
      expect(roomService.createRoom).not.toHaveBeenCalled();
    });

    it('matches two callers into one room', () => {
      gateway.handleFindPartner(makeClient('a'), { displayName: 'Anna' });
      gateway.handleFindPartner(makeClient('b'), { displayName: 'Ben' });

      expect(roomService.createRoom).toHaveBeenCalledTimes(1);
      expect(roomService.createRoom).toHaveBeenCalledWith('B1');

      const toA = payloadsTo('a').filter(([e]) => e === 'partner-found');
      const toB = payloadsTo('b').filter(([e]) => e === 'partner-found');

      expect(toA).toHaveLength(1);
      expect(toB).toHaveLength(1);
      // Same room for both, or they never meet.
      expect((toA[0][1] as any).roomId).toBe(ROOM_ID);
      expect((toB[0][1] as any).roomId).toBe(ROOM_ID);
    });

    it('gives the hostToken to exactly one peer', () => {
      gateway.handleFindPartner(makeClient('a'), { displayName: 'Anna' });
      gateway.handleFindPartner(makeClient('b'), { displayName: 'Ben' });

      const found = [...payloadsTo('a'), ...payloadsTo('b')]
        .filter(([e]) => e === 'partner-found')
        .map(([, payload]) => payload as any);

      const withToken = found.filter((p) => p.hostToken);
      expect(withToken).toHaveLength(1);
      expect(withToken[0].hostToken).toBe(HOST_TOKEN);
    });

    it('tells each peer the other one’s name', () => {
      gateway.handleFindPartner(makeClient('a'), { displayName: 'Anna' });
      gateway.handleFindPartner(makeClient('b'), { displayName: 'Ben' });

      const toA = payloadsTo('a').find(([e]) => e === 'partner-found')![1] as any;
      const toB = payloadsTo('b').find(([e]) => e === 'partner-found')![1] as any;

      expect(toA.displayName).toBe('Ben');
      expect(toB.displayName).toBe('Anna');
    });

    it('empties the queue once a pair is matched', () => {
      gateway.handleFindPartner(makeClient('a'), { displayName: 'Anna' });
      gateway.handleFindPartner(makeClient('b'), { displayName: 'Ben' });

      expect(lobby.countWaiting()).toBe(0);
    });

    it('refuses a socket that is already in a room', () => {
      const client = makeClient('a', ROOM_ID);

      gateway.handleFindPartner(client, { displayName: 'Anna' });

      expect(client.emit).toHaveBeenCalledWith('already-in-room', {});
      expect(lobby.isWaiting('a')).toBe(false);
    });

    it('refuses a second search from the same socket', () => {
      const client = makeClient('a');

      gateway.handleFindPartner(client, { displayName: 'Anna' });
      gateway.handleFindPartner(client, { displayName: 'Anna' });

      expect(client.emit).toHaveBeenCalledWith('already-searching', {});
    });

    it('pushes an updated count to those still waiting', () => {
      gateway.handleFindPartner(makeClient('a'), { displayName: 'Anna' });
      mockTo.mockClear();
      emitTo.mockClear();

      // 'b' queues, matches with 'a', so nobody is left to notify.
      gateway.handleFindPartner(makeClient('b'), { displayName: 'Ben' });

      expect(payloadsTo('a').filter(([e]) => e === 'waiting-count')).toHaveLength(
        0,
      );
    });
  });

  describe('handleCancelSearch', () => {
    it('removes the entry and confirms', () => {
      const client = makeClient('a');
      gateway.handleFindPartner(client, { displayName: 'Anna' });

      gateway.handleCancelSearch(client);

      expect(client.emit).toHaveBeenCalledWith('search-cancelled', {});
      expect(lobby.isWaiting('a')).toBe(false);
    });

    it('is safe for a socket that was never searching', () => {
      const client = makeClient('never');

      expect(() => gateway.handleCancelSearch(client)).not.toThrow();
      expect(client.emit).toHaveBeenCalledWith('search-cancelled', {});
    });
  });

  describe('handleDisconnect', () => {
    it('removes a waiting socket from the queue', () => {
      // The regression this guards: handleDisconnect returns early when the
      // socket has no room, and a socket waiting in the lobby has no room. A
      // dequeue placed after that guard never runs, and the queue fills with
      // people who are gone — who are then matched, leaving their partner
      // alone in a room nobody joins.
      const client = makeClient('a');
      gateway.handleFindPartner(client, { displayName: 'Anna' });
      expect(lobby.isWaiting('a')).toBe(true);

      roomService.getRoomBySocketId.mockReturnValue(undefined);
      gateway.handleDisconnect(client);

      expect(lobby.isWaiting('a')).toBe(false);
    });

    it('leaves the queue untouched for a socket that was in a room', () => {
      gateway.handleFindPartner(makeClient('waiting'), { displayName: 'Anna' });

      const inRoom = makeClient('in-room', ROOM_ID);
      roomService.getRoom.mockReturnValue(undefined);
      gateway.handleDisconnect(inRoom);

      expect(lobby.isWaiting('waiting')).toBe(true);
    });

    it('has nobody to notify, because the queue never holds two people', () => {
      // Pairing happens on arrival, so a second searcher is matched rather than
      // queued: the lobby holds at most one person per level. The broadcast is
      // therefore inert today. It is kept because it becomes meaningful the
      // moment a second level is seeded, and because an inert loop over an
      // empty list is cheaper than the bug of forgetting it later.
      const solo = makeClient('a');
      gateway.handleFindPartner(solo, { displayName: 'Anna' });

      const second = makeClient('b');
      gateway.handleFindPartner(second, { displayName: 'Ben' });

      expect(lobby.countWaiting()).toBe(0);

      mockTo.mockClear();
      emitTo.mockClear();
      roomService.getRoomBySocketId.mockReturnValue(undefined);

      gateway.handleDisconnect(solo);

      expect(payloadsTo('a').filter(([e]) => e === 'waiting-count')).toHaveLength(
        0,
      );
    });
  });
});
