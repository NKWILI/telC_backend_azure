import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Room } from './interfaces/room.interface';
import { CreateRoomResponseDto } from './dto/create-room-response.dto';

@Injectable()
export class RoomService {
  private readonly logger = new Logger(RoomService.name);
  private readonly rooms = new Map<string, Room>();

  createRoom(): CreateRoomResponseDto {
    const roomId = randomUUID();
    const hostToken = randomUUID();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 2 * 60 * 60 * 1000);

    const expiryTimer = setTimeout(() => {
      this.deleteRoom(roomId, 'expired');
    }, 2 * 60 * 60 * 1000);

    const room: Room = {
      roomId,
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
    this.logger.log(JSON.stringify({ event: 'room.created', roomId }));

    return { roomId, hostToken, expiresAt: expiresAt.toISOString() };
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

  startGracePeriod(roomId: string, onExpire: (guestSocketId: string | null) => void): void {
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

    this.logger.log(JSON.stringify({ event: 'guest.joined', roomId, socketId, displayName }));
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
