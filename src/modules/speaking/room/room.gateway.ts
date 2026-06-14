import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayDisconnect,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { OnApplicationShutdown, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ROOM_GATEWAY_NAMESPACE } from './constants';
import { RoomService } from './room.service';
import { JoinRoomDto } from './dto/join-room.dto';

@WebSocketGateway({ namespace: ROOM_GATEWAY_NAMESPACE, cors: { origin: '*' } })
export class RoomGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnApplicationShutdown
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RoomGateway.name);

  constructor(private readonly roomService: RoomService) {}

  handleConnection(client: Socket) {
    this.logger.log(JSON.stringify({ event: 'socket.connected', socketId: client.id }));
  }

  // ─── join-room ─────────────────────────────────────────────────────────────

  @SubscribeMessage('join-room')
  handleJoinRoom(client: Socket, data: JoinRoomDto): void {
    const { roomId, displayName, hostToken } = data;

    // EDGE-06: one-socket-one-room invariant
    if (client.data.roomId) {
      if (client.data.roomId === roomId) return; // idempotent no-op
      client.emit('already-in-room', {});
      return;
    }

    // EDGE-02: guard clause
    const room = this.roomService.getRoom(roomId);
    if (!room) {
      client.emit('room-not-found', {});
      return;
    }

    const isHost = this.roomService.verifyHostToken(roomId, hostToken ?? '');

    if (isHost) {
      this.roomService.setHost(roomId, client.id);
      client.data.roomId = roomId;
      this.logger.log(JSON.stringify({ event: 'socket.joined', roomId, role: 'host' }));

      // RC-01: guest was already waiting before host connected
      if (room.guest) {
        client.emit('guest-joined', { displayName: room.guest.displayName });
      }
    } else {
      // Guest path
      if (room.guest) {
        client.emit('room-full', {});
        return;
      }
      this.roomService.setGuest(roomId, displayName, client.id);
      client.data.roomId = roomId;
      this.logger.log(JSON.stringify({ event: 'socket.joined', roomId, role: 'guest' }));

      // Notify host if already connected
      if (room.hostSocketId) {
        this.server.to(room.hostSocketId).emit('guest-joined', { displayName });
      }
    }
  }

  // ─── offer ─────────────────────────────────────────────────────────────────

  @SubscribeMessage('offer')
  handleOffer(client: Socket, data: { roomId: string; offer: RTCSessionDescriptionInit }): void {
    const { roomId, offer } = data;

    const room = this.roomService.getRoom(roomId);
    if (!room) { client.emit('room-not-found', {}); return; }

    // SEC-03: sender must be host
    if (client.id !== room.hostSocketId) {
      client.emit('unauthorized', {});
      return;
    }

    // EDGE-01: no guest ready
    if (!room.guest) {
      client.emit('no-guest-ready', {});
      return;
    }

    this.server.to(room.guest.socketId).emit('offer', { offer });
    this.logger.log(JSON.stringify({ event: 'signal.relayed', type: 'offer', roomId, direction: 'host→guest' }));
  }

  // ─── answer ────────────────────────────────────────────────────────────────

  @SubscribeMessage('answer')
  handleAnswer(client: Socket, data: { roomId: string; answer: RTCSessionDescriptionInit }): void {
    const { roomId, answer } = data;

    const room = this.roomService.getRoom(roomId);
    if (!room) { client.emit('room-not-found', {}); return; }

    // SEC-03: sender must be guest
    if (client.id !== room.guest?.socketId) {
      client.emit('unauthorized', {});
      return;
    }

    if (!room.hostSocketId) {
      this.logger.log(JSON.stringify({ event: 'signal.dropped', type: 'answer', roomId, reason: 'no-host' }));
      return;
    }

    this.server.to(room.hostSocketId).emit('answer', { answer });
    this.logger.log(JSON.stringify({ event: 'signal.relayed', type: 'answer', roomId, direction: 'guest→host' }));
  }

  // ─── ice-candidate ─────────────────────────────────────────────────────────

  @SubscribeMessage('ice-candidate')
  handleIceCandidate(client: Socket, data: { roomId: string; candidate: RTCIceCandidateInit }): void {
    const { roomId, candidate } = data;

    const room = this.roomService.getRoom(roomId);
    if (!room) { client.emit('room-not-found', {}); return; }

    let targetSocketId: string | null = null;
    let direction: string;

    if (client.id === room.hostSocketId) {
      targetSocketId = room.guest?.socketId ?? null;
      direction = 'host→guest';
    } else if (client.id === room.guest?.socketId) {
      targetSocketId = room.hostSocketId;
      direction = 'guest→host';
    } else {
      // sender is neither — discard silently
      this.logger.log(JSON.stringify({ event: 'signal.dropped', type: 'ice-candidate', roomId, reason: 'unknown-sender' }));
      return;
    }

    if (!targetSocketId) {
      this.logger.log(JSON.stringify({ event: 'signal.dropped', type: 'ice-candidate', roomId, reason: 'no-target' }));
      return;
    }

    this.server.to(targetSocketId).emit('ice-candidate', { candidate });
    this.logger.log(JSON.stringify({ event: 'signal.relayed', type: 'ice-candidate', roomId, direction }));
  }

  // ─── disconnect ────────────────────────────────────────────────────────────

  handleDisconnect(client: Socket): void {
    this.logger.log(JSON.stringify({ event: 'socket.disconnected', socketId: client.id }));
    // Task 6 implements full disconnect logic
  }

  // ─── graceful shutdown ─────────────────────────────────────────────────────

  onApplicationShutdown(signal?: string): void {
    // Task 6 implements full shutdown logic
    this.logger.log(JSON.stringify({ event: 'server.shutdown', signal }));
  }
}
