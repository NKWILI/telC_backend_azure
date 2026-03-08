import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { TokenService } from '../auth/token.service';
import { AccessTokenPayload } from '../../shared/interfaces/token-payload.interface';

/** Payload for correction_ready event (spec §7.2). */
export interface CorrectionReadyPayload {
  attemptId: string;
  exerciseId: string;
  status: string;
  score?: number;
  feedback?: string;
  durationSeconds?: number;
  corrections?: Array<{
    original: string;
    corrected: string;
    explanation?: string;
    errorType?: string;
  }>;
}

@WebSocketGateway({
  namespace: 'writing',
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:5173'],
    credentials: true,
  },
})
@Injectable()
export class WritingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WritingGateway.name);

  constructor(private readonly tokenService: TokenService) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.query?.token as string) ||
        (client.handshake.headers?.authorization?.replace(
          'Bearer ',
          '',
        ) as string);

      if (!token) {
        client.emit('connection_error', {
          code: 4008,
          message: 'Authentication required',
        });
        client.disconnect(true);
        return;
      }

      let payload: AccessTokenPayload;
      try {
        payload = this.tokenService.verifyAccessToken(token);
      } catch {
        client.emit('connection_error', {
          code: 4009,
          message: 'Invalid or expired token',
        });
        client.disconnect(true);
        return;
      }

      const studentId = payload.studentId;
      if (!studentId) {
        client.disconnect(true);
        return;
      }

      client.join(`student:${studentId}`);
      this.logger.log(`Writing client ${client.id} joined room student:${studentId}`);
    } catch (err) {
      this.logger.warn(`Writing connection error: ${(err as Error).message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Writing client disconnected: ${client.id}`);
  }

  /**
   * Emit correction_ready to all sockets for the given student.
   * Called by the correction worker after processing.
   */
  notifyCorrectionReady(studentId: string, payload: CorrectionReadyPayload) {
    this.server.to(`student:${studentId}`).emit('correction_ready', payload);
    this.logger.log(`Emitted correction_ready for attempt ${payload.attemptId} to student ${studentId}`);
  }
}
