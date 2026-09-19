import { Injectable, Logger } from '@nestjs/common';
import { randomInt, randomUUID } from 'crypto';
import { ACTIVATION_CODE_ALPHABET } from '../../centers/activation-code-format';
import { ROOM_CODE_LENGTH } from './constants';
import { Room } from './interfaces/room.interface';
import { CreateRoomResponseDto } from './dto/create-room-response.dto';

@Injectable()
export class RoomService {
  private readonly logger = new Logger(RoomService.name);
  private readonly rooms = new Map<string, Room>();
  /** Short code → roomId, for live rooms only. */
  private readonly codes = new Map<string, string>();

  createRoom(): CreateRoomResponseDto {
    const roomId = randomUUID();
    const hostToken = randomUUID();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 2 * 60 * 60 * 1000);

    const expiryTimer = setTimeout(
      () => {
        this.deleteRoom(roomId, 'expired');
      },
      2 * 60 * 60 * 1000,
    );

    const shortCode = this.drawShortCode();
    const room: Room = {
      roomId,
      shortCode,
      hostSocketId: null,
      hostToken,
      guest: null,
      status: 'waiting',
      createdAt,
      expiresAt,
      expiryTimer,
      gracePeriodTimer: null,
    };

    this.rooms.set(roomId, room);
    this.codes.set(shortCode, roomId);
    this.logger.log(JSON.stringify({ event: 'room.created', roomId }));

    return {
      roomId,
      shortCode,
      hostToken,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * The live room a short code names, or undefined. Case-insensitive and
   * trimmed, since the code was read aloud and typed; an ended room is as
   * good as gone.
   */
  getRoomByCode(code: string): Room | undefined {
    const roomId = this.codes.get(code.trim().toUpperCase());
    const room = roomId ? this.rooms.get(roomId) : undefined;
    return room && room.status !== 'ended' ? room : undefined;
  }

  /**
   * A code no live room holds. Rooms are in this process's memory, so this
   * map is the whole truth; with hundreds of live rooms among 729 million
   * values, a second draw is already rare.
   */
  private drawShortCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code +=
          ACTIVATION_CODE_ALPHABET[randomInt(ACTIVATION_CODE_ALPHABET.length)];
      }
      if (!this.codes.has(code)) return code;
    }
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  verifyHostToken(roomId: string, token: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    return room.hostToken === token;
  }

  setHost(roomId: string, socketId: string): void {
    const room = this.rooms.get(roomId);
    if (!room || room.hostSocketId === socketId) return;

    if (room.gracePeriodTimer) {
      clearTimeout(room.gracePeriodTimer);
      room.gracePeriodTimer = null;
    }

    room.hostSocketId = socketId;
    room.status = room.guest ? 'active' : 'waiting';

    this.logger.log(JSON.stringify({ event: 'host.joined', roomId, socketId }));
  }

  startGracePeriod(
    roomId: string,
    onExpire: (guestSocketId: string | null) => void,
  ): void {
    const room = this.rooms.get(roomId);
    if (!room || room.status === 'ended') return;

    const guestSocketId = room.guest?.socketId ?? null;

    room.hostSocketId = null;
    room.status = 'ended';
    room.gracePeriodTimer = setTimeout(() => {
      onExpire(guestSocketId);
      this.deleteRoom(roomId, 'grace-period-expired');
    }, 30_000);

    this.logger.log(JSON.stringify({ event: 'grace.started', roomId }));
  }

  setGuest(roomId: string, displayName: string, socketId: string): void {
    const room = this.rooms.get(roomId);
    if (!room || room.guest?.socketId === socketId) return;

    room.guest = { displayName, socketId };
    room.status = room.hostSocketId ? 'active' : 'waiting';

    this.logger.log(
      JSON.stringify({ event: 'guest.joined', roomId, socketId, displayName }),
    );
  }

  removeGuest(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room || room.guest === null) return;

    room.guest = null;
    if (room.status !== 'ended') {
      room.status = 'waiting';
    }

    this.logger.log(JSON.stringify({ event: 'guest.removed', roomId }));
  }

  deleteRoom(roomId: string, reason = 'explicit'): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    // keep Map.delete() synchronous and first — see RC-05
    this.rooms.delete(roomId);
    // The code is free for another room from here on (D32).
    this.codes.delete(room.shortCode);
    clearTimeout(room.expiryTimer);
    clearTimeout(room.gracePeriodTimer ?? undefined);

    this.logger.log(JSON.stringify({ event: 'room.deleted', roomId, reason }));
  }

  getRoomBySocketId(socketId: string): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.hostSocketId === socketId || room.guest?.socketId === socketId) {
        return room;
      }
    }
    return undefined;
  }

  getAllRooms(): IterableIterator<Room> {
    return this.rooms.values();
  }
}
