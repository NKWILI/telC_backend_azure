import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayDisconnect,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { OnApplicationShutdown, Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ROOM_GATEWAY_NAMESPACE } from './constants';
import { RoomService } from './room.service';
import { JoinRoomDto } from './dto/join-room.dto';

@UsePipes(new ValidationPipe({ whitelist: true }))
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
      if (client.data.roomId === roomId) return;
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
      // RC-03: capture whether we are in a grace-period reconnect BEFORE setHost mutates status
      const isReconnect = room.status === 'ended' && room.hostSocketId === null;

      this.roomService.setHost(roomId, client.id);
      client.data.roomId = roomId;

      if (isReconnect && room.guest) {
        // Host reconnected during grace period — notify guest, do NOT emit guest-joined to host
        this.server.to(room.guest.socketId).emit('host-reconnected', {});
        this.logger.log(JSON.stringify({ event: 'host.reconnected', roomId }));
      } else if (room.guest) {
        // RC-01: guest was already waiting before host's first connection
        client.emit('guest-joined', { displayName: room.guest.displayName });
      }

      this.logger.log(JSON.stringify({ event: 'socket.joined', roomId, role: 'host' }));
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

    if (client.id !== room.hostSocketId) {
      client.emit('unauthorized', {});
      return;
    }

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

  // ─── leave-room ────────────────────────────────────────────────────────────

  @SubscribeMessage('leave-room')
  handleLeaveRoom(client: Socket): void {
    const room = this.roomService.getRoomBySocketId(client.id);
    if (!room) return;

    const roomId = room.roomId;

    if (client.id === room.hostSocketId) {
      if (room.guest) {
        const guestSocket = this.server.sockets.get(room.guest.socketId);
        if (guestSocket) guestSocket.data.roomId = undefined;
        this.server.to(room.guest.socketId).emit('room-ended', {});
      }
      client.data.roomId = undefined;
      this.roomService.deleteRoom(roomId);
      this.logger.log(JSON.stringify({ event: 'socket.left', roomId, role: 'host', reason: 'intentional' }));
    } else {
      if (room.hostSocketId) {
        this.server.to(room.hostSocketId).emit('partner-left', {});
      }
      client.data.roomId = undefined;
      this.roomService.removeGuest(roomId);
      this.logger.log(JSON.stringify({ event: 'socket.left', roomId, role: 'guest', reason: 'intentional' }));
    }
  }

  // ─── disconnect ────────────────────────────────────────────────────────────

  handleDisconnect(client: Socket): void {
    // EDGE-06: O(1) lookup via client.data.roomId, fall back to linear scan
    const room = client.data.roomId
      ? this.roomService.getRoom(client.data.roomId as string)
      : this.roomService.getRoomBySocketId(client.id);

    if (!room) return;

    const roomId = room.roomId;

    if (client.id === room.hostSocketId) {
      // RC-03: start grace period — capture guestSocketId NOW (GAP-2 fix)
      const guestSocketId = room.guest?.socketId ?? null;

      if (guestSocketId) {
        this.server.to(guestSocketId).emit('host-disconnected', {});
      }

      this.roomService.startGracePeriod(roomId, (capturedGuestSocketId) => {
        if (capturedGuestSocketId) {
          const guestSocket = this.server.sockets.get(capturedGuestSocketId);
          if (guestSocket) guestSocket.data.roomId = undefined;
          this.server.to(capturedGuestSocketId).emit('room-ended', {});
        }
        this.roomService.deleteRoom(roomId);
        this.logger.log(JSON.stringify({ event: 'grace.expired', roomId }));
      });

      this.logger.log(JSON.stringify({ event: 'socket.disconnected', roomId, role: 'host', reason: 'unexpected' }));
    } else {
      // Guest disconnected
      if (room.hostSocketId) {
        this.server.to(room.hostSocketId).emit('partner-left', {});
      }
      this.roomService.removeGuest(roomId);
      this.logger.log(JSON.stringify({ event: 'socket.disconnected', roomId, role: 'guest', reason: 'unexpected' }));
    }
  }

  // ─── graceful shutdown ─────────────────────────────────────────────────────

  onApplicationShutdown(signal?: string): void {
    const rooms = [...this.roomService.getAllRooms()];

    for (const room of rooms) {
      if (room.hostSocketId) {
        this.server.to(room.hostSocketId).emit('server-shutting-down', {});
      }
      if (room.guest?.socketId) {
        this.server.to(room.guest.socketId).emit('server-shutting-down', {});
      }
    }

    this.logger.log(JSON.stringify({ event: 'server.shutdown', signal, activeRooms: rooms.length }));
  }
}
