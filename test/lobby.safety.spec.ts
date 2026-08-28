import { Test, TestingModule } from '@nestjs/testing';
import { RoomGateway } from '../src/modules/speaking/room/room.gateway';
import { RoomService } from '../src/modules/speaking/room/room.service';
import { LobbyService } from '../src/modules/speaking/room/lobby.service';
import { SafetyService } from '../src/modules/speaking/room/safety.service';

const ROOM_ID = 'room-uuid-1';
const HOST = 'socket-host';
const GUEST = 'socket-guest';

function makeClient(id: string, roomId?: string) {
  return {
    id,
    emit: jest.fn(),
    data: { roomId } as Record<string, unknown>,
  } as any;
}

describe('SafetyService', () => {
  function makeService(env: Record<string, string> = {}) {
    const previous = { ...process.env };
    Object.assign(process.env, { LOBBY_BLOCK_TTL_MINUTES: '720', ...env });
    const service = new SafetyService();
    process.env = previous;
    return service;
  }

  it('blocks the pair in both directions', () => {
    // The reporter must not meet them again, and neither must they meet the
    // reporter by queueing first.
    const safety = makeService();

    safety.block('a', 'b');

    expect(safety.isBlocked('a', 'b')).toBe(true);
    expect(safety.isBlocked('b', 'a')).toBe(true);
  });

  it('leaves unrelated pairs matchable', () => {
    const safety = makeService();
    safety.block('a', 'b');

    expect(safety.isBlocked('a', 'c')).toBe(false);
  });

  it('blocks the pair when a report names one', () => {
    const safety = makeService();

    safety.report({
      roomId: ROOM_ID,
      reporterSocketId: 'a',
      reportedSocketId: 'b',
    });

    expect(safety.isBlocked('a', 'b')).toBe(true);
  });

  it('records a report even when the partner has already gone', () => {
    // The record matters more than the block here: someone who leaves the
    // moment they are reported is exactly the case worth logging.
    const safety = makeService();

    expect(() =>
      safety.report({
        roomId: ROOM_ID,
        reporterSocketId: 'a',
        reportedSocketId: null,
        reason: 'left immediately',
      }),
    ).not.toThrow();
  });

  it('expires a block after its TTL', () => {
    jest.useFakeTimers();
    try {
      const safety = makeService({ LOBBY_BLOCK_TTL_MINUTES: '10' });
      safety.block('a', 'b');

      jest.advanceTimersByTime(11 * 60_000);

      expect(safety.isBlocked('a', 'b')).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('RoomGateway — report-partner', () => {
  let gateway: RoomGateway;
  let lobby: LobbyService;
  let safety: SafetyService;
  let roomService: {
    getRoomBySocketId: jest.Mock;
    deleteRoom: jest.Mock;
    createRoom: jest.Mock;
  };
  let emitTo: jest.Mock;

  beforeEach(async () => {
    roomService = {
      getRoomBySocketId: jest.fn(),
      deleteRoom: jest.fn(),
      createRoom: jest
        .fn()
        .mockReturnValue({ roomId: ROOM_ID, hostToken: 'tok' }),
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
    safety = module.get(SafetyService);

    emitTo = jest.fn();
    gateway.server = {
      to: jest.fn().mockReturnValue({ emit: emitTo }),
      sockets: new Map(),
    } as any;
  });

  function inRoom() {
    roomService.getRoomBySocketId.mockReturnValue({
      roomId: ROOM_ID,
      hostSocketId: HOST,
      guest: { socketId: GUEST, displayName: 'Ben' },
    });
  }

  it('ends the call for both sides', () => {
    // Leaving a reported call running would make reporting something you do
    // while still being subjected to the behaviour.
    inRoom();
    const reporter = makeClient(HOST, ROOM_ID);

    gateway.handleReportPartner(reporter, { reason: 'inappropriate' });

    expect(reporter.emit).toHaveBeenCalledWith('partner-reported', {});
    expect(emitTo).toHaveBeenCalledWith('partner-reported', {});
    expect(roomService.deleteRoom).toHaveBeenCalledWith(ROOM_ID, 'reported');
  });

  it('clears the room from the reporter so they can search again', () => {
    inRoom();
    const reporter = makeClient(HOST, ROOM_ID);

    gateway.handleReportPartner(reporter, {});

    expect(reporter.data.roomId).toBeUndefined();
  });

  it('blocks the pair from being re-matched', () => {
    inRoom();

    gateway.handleReportPartner(makeClient(HOST, ROOM_ID), {});

    expect(safety.isBlocked(HOST, GUEST)).toBe(true);
  });

  it('works when the guest reports the host', () => {
    inRoom();

    gateway.handleReportPartner(makeClient(GUEST, ROOM_ID), {});

    expect(safety.isBlocked(GUEST, HOST)).toBe(true);
  });

  it('ignores a report from a socket that is not in a room', () => {
    roomService.getRoomBySocketId.mockReturnValue(undefined);
    const stray = makeClient('nobody');

    gateway.handleReportPartner(stray, { reason: 'noise' });

    expect(roomService.deleteRoom).not.toHaveBeenCalled();
    expect(stray.emit).not.toHaveBeenCalled();
  });

  it('does not re-match a blocked pair in the lobby', () => {
    // The whole point: after a report, queueing again must not put the same two
    // people back together.
    safety.block('a', 'b');

    gateway.handleFindPartner(makeClient('a'), { displayName: 'Anna' });
    gateway.handleFindPartner(makeClient('b'), { displayName: 'Ben' });

    expect(roomService.createRoom).not.toHaveBeenCalled();
    expect(lobby.isWaiting('a')).toBe(true);
    expect(lobby.isWaiting('b')).toBe(true);
  });

  it('still matches a blocked user with somebody else', () => {
    safety.block('a', 'b');

    gateway.handleFindPartner(makeClient('a'), { displayName: 'Anna' });
    gateway.handleFindPartner(makeClient('b'), { displayName: 'Ben' });
    gateway.handleFindPartner(makeClient('c'), { displayName: 'Chris' });

    // 'c' is compatible with whoever queued first, so a room is created.
    expect(roomService.createRoom).toHaveBeenCalledTimes(1);
  });
});
