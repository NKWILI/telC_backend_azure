import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { RoomController } from '../src/modules/speaking/room/room.controller';
import { RoomService } from '../src/modules/speaking/room/room.service';
import { Room } from '../src/modules/speaking/room/interfaces/room.interface';

const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const EXPIRES_AT = '2026-06-14T16:00:00.000Z';

const mockRoomService = {
  createRoom: jest.fn(),
  getRoom: jest.fn(),
};

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    roomId: VALID_UUID,
    hostSocketId: null,
    hostToken: 'secret',
    guest: null,
    status: 'waiting',
    createdAt: new Date(),
    expiresAt: new Date(EXPIRES_AT),
    expiryTimer: null as any,
    gracePeriodTimer: null,
    ...overrides,
  };
}

describe('RoomController', () => {
  let controller: RoomController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RoomController],
      providers: [{ provide: RoomService, useValue: mockRoomService }],
    }).compile();

    controller = module.get<RoomController>(RoomController);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── POST /api/speaking/rooms ──────────────────────────────────────────────

  describe('createRoom()', () => {
    it('delegates to RoomService.createRoom() and returns the DTO', () => {
      const dto = { roomId: VALID_UUID, hostToken: 'secret', expiresAt: EXPIRES_AT };
      mockRoomService.createRoom.mockReturnValue(dto);

      const result = controller.createRoom();

      expect(mockRoomService.createRoom).toHaveBeenCalledTimes(1);
      expect(result).toBe(dto);
    });
  });

  // ─── GET /api/speaking/rooms/:roomId ──────────────────────────────────────

  describe('getRoom()', () => {
    it('returns RoomInfoResponseDto for an existing waiting room', () => {
      const room = makeRoom({ hostSocketId: null, guest: null, status: 'waiting' });
      mockRoomService.getRoom.mockReturnValue(room);

      const result = controller.getRoom(VALID_UUID);

      expect(mockRoomService.getRoom).toHaveBeenCalledWith(VALID_UUID);
      expect(result).toEqual({
        roomId: VALID_UUID,
        status: 'waiting',
        hasHost: false,
        hasGuest: false,
        expiresAt: EXPIRES_AT,
      });
    });

    it('derives hasHost: true when hostSocketId is set', () => {
      const room = makeRoom({ hostSocketId: 'socket-host-1', guest: null, status: 'waiting' });
      mockRoomService.getRoom.mockReturnValue(room);

      const result = controller.getRoom(VALID_UUID);

      expect(result.hasHost).toBe(true);
    });

    it('derives hasGuest: true when guest is set', () => {
      const room = makeRoom({
        hostSocketId: 'socket-host-1',
        guest: { displayName: 'Anna', socketId: 'socket-guest-1' },
        status: 'active',
      });
      mockRoomService.getRoom.mockReturnValue(room);

      const result = controller.getRoom(VALID_UUID);

      expect(result.hasGuest).toBe(true);
      expect(result.status).toBe('active');
    });

    it('throws NotFoundException when room does not exist', () => {
      mockRoomService.getRoom.mockReturnValue(undefined);

      expect(() => controller.getRoom('unknown-id')).toThrow(NotFoundException);
    });

    it('throws NotFoundException when room status is "ended"', () => {
      const room = makeRoom({ status: 'ended' });
      mockRoomService.getRoom.mockReturnValue(room);

      expect(() => controller.getRoom(VALID_UUID)).toThrow(NotFoundException);
    });

    it('expiresAt in response is the room expiresAt as ISO string', () => {
      const room = makeRoom({ expiresAt: new Date(EXPIRES_AT) });
      mockRoomService.getRoom.mockReturnValue(room);

      const result = controller.getRoom(VALID_UUID);

      expect(result.expiresAt).toBe(EXPIRES_AT);
    });
  });
});
