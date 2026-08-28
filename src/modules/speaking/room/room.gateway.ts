import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayDisconnect,
  OnGatewayConnection,
} from '@nestjs/websockets';
import {
  OnApplicationShutdown,
  Logger,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Namespace, Socket } from 'socket.io';
import { ROOM_GATEWAY_NAMESPACE } from './constants';
import { RoomService } from './room.service';
import { LobbyService } from './lobby.service';
import { JoinRoomDto } from './dto/join-room.dto';
import { ShuffleTopicDto } from './dto/shuffle-topic.dto';
import { FindPartnerDto } from './dto/find-partner.dto';

@UsePipes(new ValidationPipe({ whitelist: true }))
@WebSocketGateway({ namespace: ROOM_GATEWAY_NAMESPACE, cors: { origin: '*' } })
export class RoomGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnApplicationShutdown
{
  // NestJS injects the namespace-scoped server here (the gateway is
  // namespaced), so the runtime type is Namespace, not Server. This matters:
  // Namespace.sockets is the Map<socketId, Socket>, whereas Server.sockets is
  // the default Namespace. Typing it correctly lets us call .sockets.get().
  @WebSocketServer()
  server: Namespace;

  private readonly logger = new Logger(RoomGateway.name);

  constructor(
    private readonly roomService: RoomService,
    private readonly lobbyService: LobbyService,
  ) {}

  handleConnection(client: Socket) {
    this.logger.log(
      JSON.stringify({ event: 'socket.connected', socketId: client.id }),
    );
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

      this.logger.log(
        JSON.stringify({ event: 'socket.joined', roomId, role: 'host' }),
      );
    } else {
      // Guest path
      if (room.guest) {
        client.emit('room-full', {});
        return;
      }
      this.roomService.setGuest(roomId, displayName, client.id);
      client.data.roomId = roomId;
      this.logger.log(
        JSON.stringify({ event: 'socket.joined', roomId, role: 'guest' }),
      );

      // Notify host if already connected
      if (room.hostSocketId) {
        this.server.to(room.hostSocketId).emit('guest-joined', { displayName });
      }
    }
  }

  // ─── find-partner ──────────────────────────────────────────────────────────

  @SubscribeMessage('find-partner')
  handleFindPartner(client: Socket, data: FindPartnerDto): void {
    // Same one-socket-one-place invariant as join-room: someone already in a
    // call cannot also be queued for another.
    if (client.data.roomId) {
      client.emit('already-in-room', {});
      return;
    }

    const level = data.level ?? 'B1';
    const result = this.lobbyService.enqueue(
      client.id,
      data.displayName,
      level,
    );

    if (result === 'already-searching') {
      client.emit('already-searching', {});
      return;
    }

    if (result === 'queue-full') {
      client.emit('lobby-full', {});
      return;
    }

    const match = this.lobbyService.findMatch(client.id);

    if (!match) {
      client.emit('waiting', {
        count: this.lobbyService.countWaiting(client.id),
      });
      this.broadcastWaitingCount();
      return;
    }

    // A match only has to produce a room; every signalling path after this is
    // the one join-room already drives. The host token goes to exactly one peer
    // and travels over the socket, never in a URL.
    const room = this.roomService.createRoom(match.host.level);

    this.server.to(match.host.socketId).emit('partner-found', {
      roomId: room.roomId,
      hostToken: room.hostToken,
      displayName: match.guest.displayName,
    });

    this.server.to(match.guest.socketId).emit('partner-found', {
      roomId: room.roomId,
      displayName: match.host.displayName,
    });

    this.logger.log(
      JSON.stringify({
        event: 'lobby.room.created',
        roomId: room.roomId,
        level: match.host.level,
      }),
    );

    this.broadcastWaitingCount();
  }

  // ─── cancel-search ─────────────────────────────────────────────────────────

  @SubscribeMessage('cancel-search')
  handleCancelSearch(client: Socket): void {
    const removed = this.lobbyService.dequeue(client.id);

    client.emit('search-cancelled', {});

    if (removed) this.broadcastWaitingCount();
  }

  /**
   * Pushes the current count to everyone still queued.
   *
   * Each socket is told how many OTHERS are waiting, so the last person in the
   * lobby sees zero rather than one — a count that includes yourself promises a
   * match that cannot happen.
   */
  private broadcastWaitingCount(): void {
    for (const socketId of this.lobbyService.waitingSocketIds()) {
      this.server.to(socketId).emit('waiting-count', {
        count: this.lobbyService.countWaiting(socketId),
      });
    }
  }

  // ─── offer ─────────────────────────────────────────────────────────────────

  @SubscribeMessage('shuffle-topic')
  handleShuffleTopic(client: Socket, data: ShuffleTopicDto): void {
    const room = this.roomService.getRoom(data.roomId);

    if (!room || room.status === 'ended') {
      client.emit('room-not-found', {});
      return;
    }

    if (client.id !== room.hostSocketId || client.data.roomId !== data.roomId) {
      client.emit('unauthorized', {});
      return;
    }

    const topic = this.roomService.selectNextTopic(data.roomId);
    if (!topic) {
      client.emit('room-not-found', {});
      return;
    }

    this.server.to(client.id).emit('topic-changed', { topic });
    if (room.guest) {
      this.server.to(room.guest.socketId).emit('topic-changed', { topic });
    }
  }

  @SubscribeMessage('offer')
  handleOffer(
    client: Socket,
    data: { roomId: string; offer: RTCSessionDescriptionInit },
  ): void {
    const { roomId, offer } = data;

    const room = this.roomService.getRoom(roomId);
    if (!room) {
      client.emit('room-not-found', {});
      return;
    }

    if (client.id !== room.hostSocketId) {
      client.emit('unauthorized', {});
      return;
    }

    if (!room.guest) {
      client.emit('no-guest-ready', {});
      return;
    }

    this.server.to(room.guest.socketId).emit('offer', { offer });
    this.logger.log(
      JSON.stringify({
        event: 'signal.relayed',
        type: 'offer',
        roomId,
        direction: 'host→guest',
      }),
    );
  }

  // ─── answer ────────────────────────────────────────────────────────────────

  @SubscribeMessage('answer')
  handleAnswer(
    client: Socket,
    data: { roomId: string; answer: RTCSessionDescriptionInit },
  ): void {
    const { roomId, answer } = data;

    const room = this.roomService.getRoom(roomId);
    if (!room) {
      client.emit('room-not-found', {});
      return;
    }

    if (client.id !== room.guest?.socketId) {
      client.emit('unauthorized', {});
      return;
    }

    if (!room.hostSocketId) {
      this.logger.log(
        JSON.stringify({
          event: 'signal.dropped',
          type: 'answer',
          roomId,
          reason: 'no-host',
        }),
      );
      return;
    }

    this.server.to(room.hostSocketId).emit('answer', { answer });
    this.logger.log(
      JSON.stringify({
        event: 'signal.relayed',
        type: 'answer',
        roomId,
        direction: 'guest→host',
      }),
    );
  }

  // ─── ice-candidate ─────────────────────────────────────────────────────────

  @SubscribeMessage('ice-candidate')
  handleIceCandidate(
    client: Socket,
    data: { roomId: string; candidate: RTCIceCandidateInit },
  ): void {
    const { roomId, candidate } = data;

    const room = this.roomService.getRoom(roomId);
    if (!room) {
      client.emit('room-not-found', {});
      return;
    }

    let targetSocketId: string | null = null;
    let direction: string;

    if (client.id === room.hostSocketId) {
      targetSocketId = room.guest?.socketId ?? null;
      direction = 'host→guest';
    } else if (client.id === room.guest?.socketId) {
      targetSocketId = room.hostSocketId;
      direction = 'guest→host';
    } else {
      this.logger.log(
        JSON.stringify({
          event: 'signal.dropped',
          type: 'ice-candidate',
          roomId,
          reason: 'unknown-sender',
        }),
      );
      return;
    }

    if (!targetSocketId) {
      this.logger.log(
        JSON.stringify({
          event: 'signal.dropped',
          type: 'ice-candidate',
          roomId,
          reason: 'no-target',
        }),
      );
      return;
    }

    this.server.to(targetSocketId).emit('ice-candidate', { candidate });
    this.logger.log(
      JSON.stringify({
        event: 'signal.relayed',
        type: 'ice-candidate',
        roomId,
        direction,
      }),
    );
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
      this.logger.log(
        JSON.stringify({
          event: 'socket.left',
          roomId,
          role: 'host',
          reason: 'intentional',
        }),
      );
    } else {
      if (room.hostSocketId) {
        this.server.to(room.hostSocketId).emit('partner-left', {});
      }
      client.data.roomId = undefined;
      this.roomService.removeGuest(roomId);
      this.logger.log(
        JSON.stringify({
          event: 'socket.left',
          roomId,
          role: 'guest',
          reason: 'intentional',
        }),
      );
    }
  }

  // ─── disconnect ────────────────────────────────────────────────────────────

  handleDisconnect(client: Socket): void {
    // MUST come before the `if (!room) return` below. A socket waiting in the
    // lobby has no room, so it takes that early return: a dequeue placed any
    // later would never run for exactly the sockets that need it, and the queue
    // would fill with entries for people who are gone. They would then be
    // matched, and their partner would wait in a room nobody joins.
    if (this.lobbyService.dequeue(client.id)) {
      this.broadcastWaitingCount();
    }

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

      this.logger.log(
        JSON.stringify({
          event: 'socket.disconnected',
          roomId,
          role: 'host',
          reason: 'unexpected',
        }),
      );
    } else {
      // Guest disconnected
      if (room.hostSocketId) {
        this.server.to(room.hostSocketId).emit('partner-left', {});
      }
      this.roomService.removeGuest(roomId);
      this.logger.log(
        JSON.stringify({
          event: 'socket.disconnected',
          roomId,
          role: 'guest',
          reason: 'unexpected',
        }),
      );
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

    this.logger.log(
      JSON.stringify({
        event: 'server.shutdown',
        signal,
        activeRooms: rooms.length,
      }),
    );
  }
}
