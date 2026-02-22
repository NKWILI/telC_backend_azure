import {
  WebSocketGateway,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { TokenService } from '../auth/token.service';
import { AccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { SpeakingService } from './services/speaking.service';
import { GeminiService, GeminiSessionCallbacks } from './services/gemini.service';
import { DatabaseService } from '../../shared/services/database.service';
import { SessionContext } from './interfaces/session.interface';
import { AudioChunkDto } from './dto/audio-chunk.dto';

@WebSocketGateway({
  namespace: 'speaking',
  cors: {
    origin: '*',
  },
})
@Injectable()
export class SpeakingGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger('SpeakingGateway');

  // In-memory session storage: Map<clientId, SessionContext>
  private readonly sessions = new Map<string, SessionContext>();

  // Idle timeout trackers: Map<clientId, timeoutId>
  private readonly idleTimeouts = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly speakingService: SpeakingService,
    private readonly geminiService: GeminiService,
    private readonly databaseService: DatabaseService,
    private readonly tokenService: TokenService,
  ) {}

  /**
   * Handle new WebSocket connection
   * Validates session from query parameter and initializes Gemini connection
   */
  async handleConnection(client: Socket) {
    try {
      this.logger.log(`Client connecting: ${client.id}`);

      // Extract sessionId from query parameters
      const sessionId = client.handshake.query.sessionId as string;

      if (!sessionId) {
        this.logger.warn(`Client ${client.id}: Missing sessionId in query`);
        client.emit('connection_error', {
          code: 4001,
          message: 'Missing sessionId',
        });
        client.disconnect(true);
        return;
      }

      // Authenticate: extract and verify JWT token
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.query?.token as string) ||
        (client.handshake.headers?.authorization?.replace(
          'Bearer ',
          '',
        ) as string);

      if (!token) {
        this.logger.warn(
          `Client ${client.id}: No authentication token provided`,
        );
        client.emit('connection_error', {
          code: 4008,
          message: 'Authentication required',
        });
        client.disconnect(true);
        return;
      }

      let studentPayload: AccessTokenPayload;
      try {
        studentPayload = this.tokenService.verifyAccessToken(token);
      } catch (err) {
        this.logger.warn(
          `Client ${client.id}: Invalid token: ${(err as Error).message}`,
        );
        client.emit('connection_error', {
          code: 4009,
          message: 'Invalid or expired token',
        });
        client.disconnect(true);
        return;
      }

      const authenticatedStudentId = studentPayload.studentId;
      this.logger.log(
        `Client ${client.id} authenticated as student ${authenticatedStudentId}`,
      );

      // Check for reconnection during grace period (before DB validation)
      const existingEntry = this.findSessionBySessionId(sessionId);
      if (existingEntry) {
        const [oldClientId, existingContext] = existingEntry;

        if (existingContext.disconnectTimer) {
          // Verify the reconnecting client is the same student
          if (existingContext.studentId !== authenticatedStudentId) {
            this.logger.warn(
              `Client ${client.id}: Student ${authenticatedStudentId} tried to reconnect to session owned by ${existingContext.studentId}`,
            );
            client.emit('connection_error', {
              code: 4010,
              message: 'Session does not belong to authenticated student',
            });
            client.disconnect(true);
            return;
          }

          // Grace period is active — allow reconnection by transferring context
          this.logger.log(
            `Reconnection during grace period for session ${sessionId} (old: ${oldClientId}, new: ${client.id})`,
          );

          // Cancel the grace period cleanup
          clearTimeout(existingContext.disconnectTimer);
          existingContext.disconnectTimer = null;

          // Clear idle timeout from old client
          if (this.idleTimeouts.has(oldClientId)) {
            clearTimeout(this.idleTimeouts.get(oldClientId));
            this.idleTimeouts.delete(oldClientId);
          }

          // Transfer context to the new client
          existingContext.clientId = client.id;
          existingContext.status = 'active';
          existingContext.lastAudioTimestamp = new Date();
          this.sessions.delete(oldClientId);
          this.sessions.set(client.id, existingContext);

          const sessionReadyPayload = {
            sessionId,
            teilNumber: existingContext.teilNumber,
            serverStartTime: existingContext.startTime.toISOString(),
            timeLimit: existingContext.timeLimit,
            status: 'reconnected',
            message: 'Reconnected to existing session during grace period',
          };
          this.logger.log(
            `[SpeakingGateway] envoi → client session_ready: ${JSON.stringify(sessionReadyPayload)}`,
          );
          client.emit('session_ready', sessionReadyPayload);

          this.logger.log(
            `Client ${client.id} reconnected to session ${sessionId}`,
          );
          return;
        }

        // Not in grace period — true duplicate connection
        this.logger.warn(
          `Session ${sessionId} already has active connection from ${oldClientId}`,
        );
        client.emit('connection_error', {
          code: 4006,
          message: 'Session already connected',
        });
        client.disconnect(true);
        return;
      }

      // Step 1: Validate session exists in database
      const { data: examSession, error: sessionError } =
        await this.databaseService
          .getClient()
          .from('exam_sessions')
          .select('*')
          .eq('session_id', sessionId)
          .single();

      if (sessionError || !examSession) {
        this.logger.warn(
          `Client ${client.id}: Session not found or error: ${sessionError?.message}`,
        );
        client.emit('connection_error', {
          code: 4001,
          message: 'Session not found',
        });
        client.disconnect(true);
        return;
      }

      // Step 2: Validate session status is 'active'
      if (examSession.status !== 'active') {
        this.logger.warn(
          `Client ${client.id}: Session status is '${examSession.status}', not 'active'`,
        );
        client.emit('connection_error', {
          code: 4002,
          message: `Invalid session status: ${examSession.status}`,
        });
        client.disconnect(true);
        return;
      }

      // Verify the authenticated student owns this session
      const studentId = examSession.student_id;
      if (studentId !== authenticatedStudentId) {
        this.logger.warn(
          `Client ${client.id}: Student ${authenticatedStudentId} does not own session ${sessionId} (owner: ${studentId})`,
        );
        client.emit('connection_error', {
          code: 4010,
          message: 'Session does not belong to authenticated student',
        });
        client.disconnect(true);
        return;
      }

      // Step 3: Validate student's activation code
      const { data: student, error: studentError } = await this.databaseService
        .getClient()
        .from('students')
        .select('id, activation_code')
        .eq('id', studentId)
        .single();

      if (studentError || !student) {
        this.logger.warn(
          `Client ${client.id}: Student not found or error: ${studentError?.message}`,
        );
        client.emit('connection_error', {
          code: 4003,
          message: 'Student validation failed',
        });
        client.disconnect(true);
        return;
      }

      // Verify activation code is valid and not expired
      const { data: activationCode, error: acError } =
        await this.databaseService
          .getClient()
          .from('activation_codes')
          .select('code, status, expires_at')
          .eq('code', student.activation_code)
          .single();

      if (acError || !activationCode || activationCode.status !== 'active') {
        this.logger.warn(
          `Client ${client.id}: Student ${studentId} has no active activation code`,
        );
        client.emit('connection_error', {
          code: 4004,
          message: 'No active activation code',
        });
        client.disconnect(true);
        return;
      }

      if (
        activationCode.expires_at &&
        new Date(activationCode.expires_at) < new Date()
      ) {
        this.logger.warn(
          `Client ${client.id}: Student ${studentId} activation code expired`,
        );
        client.emit('connection_error', {
          code: 4005,
          message: 'Activation code expired',
        });
        client.disconnect(true);
        return;
      }

      this.logger.log(
        `Validation passed for client ${client.id}, session ${sessionId}`,
      );

      // Step 4: Initialize Gemini Live session
      this.logger.log(
        `Initializing Gemini for session ${sessionId}, Teil ${examSession.teil_number}`,
      );

      // Step 5: Create in-memory session context (before Gemini init so callbacks can reference it)
      const sessionContext: SessionContext = {
        clientId: client.id,
        sessionId,
        studentId,
        teilNumber: examSession.teil_number,
        conversationHistory: [],
        status: 'active',
        startTime: new Date(examSession.server_start_time),
        elapsedSeconds: examSession.elapsed_time || 0,
        timeLimit: examSession.use_timer
          ? examSession.teil_number === 1
            ? 240
            : 360
          : null,
        expectedEndTime: examSession.use_timer
          ? new Date(
              new Date(examSession.server_start_time).getTime() +
                (examSession.teil_number === 1 ? 240000 : 360000),
            )
          : null,
        disconnectTimer: null,
        pauseTimer: null,
        lastAudioTimestamp: new Date(),
        pausePending: false,
        geminiConnectionAttempts: 1,
        lastGeminiError: null,
        chunkTimestamps: [], // Initialize for rate limiting
        timerHandles: [], // Initialize for timer cleanup
      };

      try {
        await this.geminiService.createLiveSession(
          sessionId,
          examSession.teil_number,
          this.createGeminiCallbacks(client, sessionContext),
          [], // Start with empty conversation history
        );
      } catch (geminiError) {
        this.logger.error(
          `Gemini initialization failed: ${geminiError.message}`,
        );
        client.emit('connection_error', {
          code: 4007,
          message: 'Gemini API initialization failed',
          details: geminiError.message,
        });
        client.disconnect(true);
        return;
      }

      // Verify Gemini session was created
      if (!this.geminiService.isSessionActive(sessionId)) {
        this.logger.error(
          `Gemini session not active after creation for ${sessionId}`,
        );
        client.emit('connection_error', {
          code: 4007,
          message: 'Gemini session initialization failed',
        });
        client.disconnect(true);
        return;
      }

      // Store session in Map
      this.sessions.set(client.id, sessionContext);

      this.logger.log(
        `Session context created for client ${client.id}, session ${sessionId}`,
      );

      // Trigger examiner's initial greeting so the student doesn't have to speak first
      this.geminiService.triggerExaminerGreeting(sessionId);

      // Step 7: Emit session_ready event to client
      const sessionReadyPayload = {
        sessionId,
        teilNumber: examSession.teil_number,
        serverStartTime: examSession.server_start_time,
        timeLimit: sessionContext.timeLimit,
        status: 'ready',
        message:
          'WebSocket connection established and Gemini session initialized',
      };
      this.logger.log(
        `[SpeakingGateway] envoi → client session_ready: ${JSON.stringify(sessionReadyPayload)}`,
      );
      client.emit('session_ready', sessionReadyPayload);

      // Step 8: Set up timer warnings and auto-end if timer is enabled
      if (sessionContext.timeLimit && sessionContext.expectedEndTime) {
        this.setupTimerWarnings(client, sessionContext);
        this.setupAutoEnd(client, sessionContext);
      }

      this.logger.log(
        `Client ${client.id} successfully connected to session ${sessionId}`,
      );
    } catch (error) {
      this.logger.error(
        `Unexpected error during connection: ${error.message}`,
        error.stack,
      );
      client.emit('connection_error', {
        code: 5000,
        message: 'Unexpected server error',
      });
      client.disconnect(true);
    }
  }

  /**
   * Handle client disconnection with grace period
   */
  async handleDisconnect(client: Socket) {
    try {
      this.logger.log(`Client disconnecting: ${client.id}`);

      const context = this.sessions.get(client.id);

      if (!context) {
        this.logger.warn(`No session context found for client ${client.id}`);
        return;
      }

      // Clear any pending timeouts
      if (context.disconnectTimer) {
        clearTimeout(context.disconnectTimer);
      }
      if (context.pauseTimer) {
        clearTimeout(context.pauseTimer);
      }

      // Clear timer warning and auto-end handles
      if (context.timerHandles) {
        for (const handle of context.timerHandles) {
          clearTimeout(handle);
        }
        context.timerHandles = [];
      }

      // Clear pause Gemini close timer
      if (context.pauseGeminiCloseTimer) {
        clearTimeout(context.pauseGeminiCloseTimer);
        context.pauseGeminiCloseTimer = undefined;
      }

      // Clear idle timeout
      if (this.idleTimeouts.has(client.id)) {
        clearTimeout(this.idleTimeouts.get(client.id));
        this.idleTimeouts.delete(client.id);
      }

      // Save transcript IMMEDIATELY on disconnect (before grace period)
      if (context.conversationHistory && context.conversationHistory.length > 0) {
        this.logger.log(
          `Saving transcript on disconnect for session ${context.sessionId}`,
        );
        await this.speakingService.saveConversationHistory(
          context.sessionId,
          context.conversationHistory,
        );
      }

      // Snapshot elapsed time and mark as grace period
      context.elapsedSeconds = this.getElapsedSeconds(context);
      context.status = 'grace_period';

      // Set grace period: wait 5 seconds to see if client reconnects
      const graceTimeout = setTimeout(async () => {
        try {
          this.logger.log(
            `Grace period expired for session ${context.sessionId}, closing Gemini connection`,
          );

          // Close Gemini session
          this.geminiService.closeLiveSession(context.sessionId);

          // Update database: mark session as interrupted if still active/paused
          const { data: session } = await this.databaseService
            .getClient()
            .from('exam_sessions')
            .select('status')
            .eq('session_id', context.sessionId)
            .single();

          if (
            session &&
            (session.status === 'active' || session.status === 'paused')
          ) {
            // Note: Transcript already saved in handleDisconnect before grace period

            await this.databaseService
              .getClient()
              .from('exam_sessions')
              .update({
                status: 'interrupted',
                completed_at: new Date().toISOString(),
                elapsed_time: context.elapsedSeconds,
              })
              .eq('session_id', context.sessionId);

            this.logger.log(
              `Session ${context.sessionId} marked as interrupted due to disconnect`,
            );
          }

          // Clean up in-memory context
          this.sessions.delete(client.id);

          this.logger.log(
            `Session ${context.sessionId} cleaned up after graceful disconnect`,
          );
        } catch (error) {
          this.logger.error(
            `Error during grace period cleanup for session ${context.sessionId}: ${error.message}`,
          );
        }
      }, 5000); // 5-second grace period

      context.disconnectTimer = graceTimeout;

      this.logger.log(
        `Grace period started for session ${context.sessionId} (5 seconds)`,
      );
    } catch (error) {
      this.logger.error(
        `Error in handleDisconnect: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Handle incoming audio chunks from client
   */
  @SubscribeMessage('audio_chunk')
  async handleAudioChunk(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: AudioChunkDto,
  ): Promise<void> {
    const payloadDesc =
      typeof payload === 'string'
        ? `string length=${(payload as string).length}`
        : payload?.data != null
          ? `data length=${(payload as { data?: string }).data?.length ?? 0}`
          : JSON.stringify(payload).slice(0, 200);
    this.logger.log(
      `[SpeakingGateway] reçu ← client audio_chunk (${client.id}): ${payloadDesc}`,
    );
    try {
      const context = this.sessions.get(client.id);

      if (!context) {
        this.logger.warn(
          `Audio chunk received but no session context for client ${client.id}`,
        );
        client.emit('error', {
          code: 'SESSION_NOT_FOUND',
          message: 'Session context not found',
          clientId: client.id,
        });
        return;
      }

      // Validate session is active
      if (context.status !== 'active') {
        this.logger.warn(
          `Audio chunk received but session ${context.sessionId} status is ${context.status}`,
        );
        client.emit('error', {
          code: 'SESSION_NOT_ACTIVE',
          message: `Session status is ${context.status}, expected 'active'`,
          sessionId: context.sessionId,
          clientId: client.id,
        });
        return;
      }

      // Update last audio timestamp (prevent idle timeout)
      context.lastAudioTimestamp = new Date();

      // Clear any existing idle timeout
      if (this.idleTimeouts.has(client.id)) {
        clearTimeout(this.idleTimeouts.get(client.id));
        this.idleTimeouts.delete(client.id);
      }

      // Validate audio data
      if (!payload.data || typeof payload.data !== 'string') {
        this.logger.warn(
          `Invalid audio data format from client ${client.id} for session ${context.sessionId}`,
        );
        client.emit('error', {
          code: 'INVALID_AUDIO_FORMAT',
          message: 'Audio data must be a non-empty Base64 string',
          sessionId: context.sessionId,
          clientId: client.id,
        });
        return;
      }

      // Validate Base64 encoding
      if (!this.isValidBase64(payload.data)) {
        this.logger.warn(
          `Invalid Base64 encoding from client ${client.id} for session ${context.sessionId}`,
        );
        client.emit('error', {
          code: 'INVALID_BASE64',
          message: 'Audio data must be valid Base64 encoded',
          sessionId: context.sessionId,
          clientId: client.id,
        });
        return;
      }

      // CRITICAL FIX #1: Enforce audio chunk size limit (DoS protection)
      const MAX_AUDIO_CHUNK_SIZE = 100 * 1024; // 100KB Base64 = ~75KB binary
      if (payload.data.length > MAX_AUDIO_CHUNK_SIZE) {
        this.logger.warn(
          `Audio chunk rejected: ${payload.data.length} bytes exceeds ${MAX_AUDIO_CHUNK_SIZE} limit (session ${context.sessionId})`,
        );
        client.emit('error', {
          code: 'AUDIO_CHUNK_TOO_LARGE',
          message: `Audio chunk must not exceed ${MAX_AUDIO_CHUNK_SIZE} bytes`,
          sessionId: context.sessionId,
          clientId: client.id,
        });
        return;
      }

      // CRITICAL FIX #2: Rate limiting on audio chunks (prevent flooding)
      const now = Date.now();
      const recentChunks = context.chunkTimestamps.filter(
        (t) => now - t < 1000,
      );
      if (recentChunks.length >= 50) {
        // Max 50 chunks/second
        this.logger.warn(
          `Rate limit exceeded for client ${client.id} (session ${context.sessionId}): ${recentChunks.length} chunks in last second`,
        );
        client.emit('error', {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many audio chunks. Maximum 50 chunks per second.',
          sessionId: context.sessionId,
          clientId: client.id,
        });
        return;
      }
      context.chunkTimestamps.push(now);
      // Keep only last 100 timestamps to prevent unbounded growth
      if (context.chunkTimestamps.length > 100) {
        context.chunkTimestamps = context.chunkTimestamps.slice(-100);
      }

      // Get Gemini session
      if (!this.geminiService.isSessionActive(context.sessionId)) {
        this.logger.error(
          `No Gemini session active for session ${context.sessionId}`,
        );
        client.emit('error', {
          code: 'GEMINI_SESSION_NOT_FOUND',
          message: 'Gemini session not initialized',
          sessionId: context.sessionId,
          clientId: client.id,
        });
        return;
      }

      this.logger.debug(
        `Forwarding audio chunk to Gemini (size: ${payload.data.length} bytes) for session ${context.sessionId}`,
      );

      // Forward audio to Gemini (fire-and-forget, responses come via callbacks)
      try {
        this.geminiService.sendAudioChunk(
          context.sessionId,
          payload.data,
          'audio/pcm;rate=16000',
        );

        this.logger.debug(
          `Audio chunk forwarded to Gemini for session ${context.sessionId}`,
        );
        // NOTE: Do NOT send sendClientContent({ turnComplete: true }) when using
        // realtime audio (sendRealtimeInput). The Live API rejects it with
        // code=1007 "Request contains an invalid argument" and closes the session.
        // For audio-only sessions, rely on Gemini VAD to trigger responses.
      } catch (geminiError) {
        this.logger.error(
          `Error forwarding audio to Gemini for session ${context.sessionId}: ${geminiError.message}`,
        );

        context.lastGeminiError = geminiError.message;
        context.status = 'interrupted';

        // Notify client of Gemini error
        client.emit('gemini_error', {
          code: 'AUDIO_FORWARD_FAILED',
          message: 'Failed to forward audio to Gemini API',
          details: geminiError.message,
        });

        // Mark session as interrupted in database
        try {
          // Save conversation history before marking as interrupted
          if (context.conversationHistory.length > 0) {
            await this.speakingService.saveConversationHistory(
              context.sessionId,
              context.conversationHistory,
            );
          }

          await this.databaseService
            .getClient()
            .from('exam_sessions')
            .update({
              status: 'interrupted',
              completed_at: new Date().toISOString(),
              elapsed_time: this.getElapsedSeconds(context),
            })
            .eq('session_id', context.sessionId);
        } catch (dbError) {
          this.logger.error(
            `Failed to update session status in database: ${dbError.message}`,
          );
        }

        return;
      }

      // Note: Student speech transcription will be recorded when Gemini provides transcript via Live API

      // Set idle timeout (clear audio if no chunks received for X seconds)
      const idleTimeout = setTimeout(() => {
        this.logger.warn(
          `Audio idle timeout for session ${context.sessionId} (no audio for 60s)`,
        );
        // Could emit warning or pause session here
      }, 60000);

      this.idleTimeouts.set(client.id, idleTimeout);
    } catch (error) {
      const context = this.sessions.get(client.id);
      this.logger.error(
        `Unexpected error in handleAudioChunk: ${error.message}`,
        error.stack,
      );
      client.emit('error', {
        code: 'INTERNAL_ERROR',
        message: 'Unexpected server error',
        sessionId: context?.sessionId || 'unknown',
        clientId: client.id,
      });
    }
  }

  /**
   * Handle pause request from client
   * Keeps Gemini alive for 60 seconds, then closes if not resumed
   */
  @SubscribeMessage('pause_session')
  async handlePauseSession(
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    try {
      const context = this.sessions.get(client.id);

      if (!context) {
        this.logger.warn(
          `Pause requested but no session for client ${client.id}`,
        );
        client.emit('error', {
          code: 'SESSION_NOT_FOUND',
          message: 'No active session found',
        });
        return;
      }

      if (context.status !== 'active') {
        this.logger.warn(
          `Pause requested but session ${context.sessionId} is ${context.status}`,
        );
        client.emit('error', {
          code: 'INVALID_SESSION_STATE',
          message: `Cannot pause session in ${context.status} state`,
        });
        return;
      }

      this.logger.log(`Pausing session ${context.sessionId}`);

      // Clear idle timeout during pause
      if (this.idleTimeouts.has(client.id)) {
        clearTimeout(this.idleTimeouts.get(client.id));
        this.idleTimeouts.delete(client.id);
      }

      // Clear timer handles to prevent warnings during pause
      if (context.timerHandles && context.timerHandles.length > 0) {
        this.logger.log(
          `Clearing ${context.timerHandles.length} timer handles for paused session`,
        );
        context.timerHandles.forEach((handle) => clearTimeout(handle));
        context.timerHandles = [];
      }

      // Update context status
      context.status = 'paused';
      context.elapsedSeconds = this.getElapsedSeconds(context);

      // Update database
      const { error } = await this.databaseService
        .getClient()
        .from('exam_sessions')
        .update({
          status: 'paused',
          pause_timestamp: new Date().toISOString(),
          elapsed_time: context.elapsedSeconds,
        })
        .eq('session_id', context.sessionId);

      if (error) {
        this.logger.error(
          `Failed to update session to paused: ${error.message}`,
        );
        client.emit('error', {
          code: 'DATABASE_ERROR',
          message: 'Failed to pause session',
        });
        return;
      }

      // Set 60-second timer to close Gemini if not resumed
      const pauseCloseTimer = setTimeout(() => {
        this.logger.log(
          `Pause timeout (60s) expired for session ${context.sessionId}, closing Gemini`,
        );

        // Close Gemini session
        this.geminiService.closeLiveSession(context.sessionId);

        // Update status to grace_period
        context.status = 'grace_period';

        // Notify client
        if (client.connected) {
          client.emit('pause_timeout', {
            message: 'Pause exceeded 60 seconds, Gemini connection closed',
          });
        }
      }, 60000); // 60 seconds

      context.pauseGeminiCloseTimer = pauseCloseTimer;

      // Emit success
      const sessionPausedPayload = {
        sessionId: context.sessionId,
        elapsedSeconds: context.elapsedSeconds,
        message: 'Session paused, you have 60 seconds to resume',
      };
      this.logger.log(
        `[SpeakingGateway] envoi → client session_paused: ${JSON.stringify(sessionPausedPayload)}`,
      );
      client.emit('session_paused', sessionPausedPayload);

      this.logger.log(
        `Session ${context.sessionId} paused, Gemini will close in 60s if not resumed`,
      );
    } catch (error) {
      this.logger.error(
        `Error in handlePauseSession: ${error.message}`,
        error.stack,
      );
      client.emit('error', {
        code: 'PAUSE_FAILED',
        message: 'Unexpected error during pause',
      });
    }
  }

  /**
   * Handle resume request from client
   * Cancels Gemini close timer or re-initializes if already closed
   */
  @SubscribeMessage('resume_session')
  async handleResumeSession(
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    try {
      const context = this.sessions.get(client.id);

      if (!context) {
        this.logger.warn(
          `Resume requested but no session for client ${client.id}`,
        );
        client.emit('error', {
          code: 'SESSION_NOT_FOUND',
          message: 'No active session found',
        });
        return;
      }

      if (context.status !== 'paused' && context.status !== 'grace_period') {
        this.logger.warn(
          `Resume requested but session ${context.sessionId} is ${context.status}`,
        );
        client.emit('error', {
          code: 'INVALID_SESSION_STATE',
          message: `Cannot resume session in ${context.status} state`,
        });
        return;
      }

      this.logger.log(`Resuming session ${context.sessionId}`);

      // Cancel Gemini close timer if still active
      if (context.pauseGeminiCloseTimer) {
        clearTimeout(context.pauseGeminiCloseTimer);
        context.pauseGeminiCloseTimer = undefined;
        this.logger.log('Cancelled Gemini close timer (resume within 60s)');
      }

      // Check if Gemini session still exists
      const geminiActive = this.geminiService.isSessionActive(
        context.sessionId,
      );

      if (!geminiActive) {
        // Gemini was closed during pause - re-initialize
        this.logger.log(
          `Gemini session was closed, re-initializing for ${context.sessionId}`,
        );

        try {
          await this.geminiService.createLiveSession(
            context.sessionId,
            context.teilNumber,
            this.createGeminiCallbacks(client, context),
            context.conversationHistory,
          );

          this.logger.log('Gemini session re-initialized successfully');
          // Trigger examiner to resume the conversation
          this.geminiService.triggerExaminerGreeting(context.sessionId);
        } catch (reinitError) {
          this.logger.error(
            `Failed to re-initialize Gemini: ${reinitError.message}`,
          );
          client.emit('error', {
            code: 'GEMINI_REINIT_FAILED',
            message: 'Failed to re-initialize Gemini session',
          });
          return;
        }
      }

      // Update context
      context.status = 'active';
      context.lastAudioTimestamp = new Date();

      // Calculate new start time to account for pause duration
      const pauseDuration = context.elapsedSeconds;
      context.startTime = new Date(Date.now() - pauseDuration * 1000);

      // Re-setup timer warnings and auto-end to account for pause duration
      if (context.timerHandles) {
        for (const handle of context.timerHandles) {
          clearTimeout(handle);
        }
        context.timerHandles = [];
      }
      if (context.timeLimit && context.expectedEndTime) {
        context.expectedEndTime = new Date(
          context.startTime.getTime() + context.timeLimit * 1000,
        );
        this.setupTimerWarnings(client, context);
        this.setupAutoEnd(client, context);
      }

      // Update database
      const { error } = await this.databaseService
        .getClient()
        .from('exam_sessions')
        .update({
          status: 'active',
          pause_timestamp: null,
        })
        .eq('session_id', context.sessionId);

      if (error) {
        this.logger.error(
          `Failed to update session to active: ${error.message}`,
        );
      }

      // Emit success
      const sessionResumedPayload = {
        sessionId: context.sessionId,
        message: 'Session resumed, you can continue speaking',
      };
      this.logger.log(
        `[SpeakingGateway] envoi → client session_resumed: ${JSON.stringify(sessionResumedPayload)}`,
      );
      client.emit('session_resumed', sessionResumedPayload);

      this.logger.log(`Session ${context.sessionId} resumed successfully`);
    } catch (error) {
      this.logger.error(
        `Error in handleResumeSession: ${error.message}`,
        error.stack,
      );
      client.emit('error', {
        code: 'RESUME_FAILED',
        message: 'Unexpected error during resume',
      });
    }
  }

  /**
   * Find session context by sessionId (scans all client entries)
   */
  private findSessionBySessionId(
    sessionId: string,
  ): [string, SessionContext] | null {
    for (const [clientId, context] of this.sessions.entries()) {
      if (context.sessionId === sessionId) {
        return [clientId, context];
      }
    }
    return null;
  }

  /**
   * Close session immediately when POST /session/:id/end is called.
   * Closes Gemini, clears context and timers, disconnects the client.
   * Avoids grace period so the next session can start without conflicts.
   */
  async closeSessionImmediately(sessionId: string): Promise<void> {
    const entry = this.findSessionBySessionId(sessionId);
    if (!entry) {
      this.logger.log(
        `closeSessionImmediately: no active WebSocket session for ${sessionId}`,
      );
      return;
    }
    const [clientId, context] = entry;

    this.logger.log(
      `Closing session ${sessionId} immediately (POST end), client ${clientId}`,
    );

    if (context.disconnectTimer) {
      clearTimeout(context.disconnectTimer);
      context.disconnectTimer = null;
    }
    if (context.pauseTimer) {
      clearTimeout(context.pauseTimer);
      context.pauseTimer = null;
    }
    if (context.timerHandles?.length) {
      for (const handle of context.timerHandles) {
        clearTimeout(handle);
      }
      context.timerHandles = [];
    }
    if (context.pauseGeminiCloseTimer) {
      clearTimeout(context.pauseGeminiCloseTimer);
      context.pauseGeminiCloseTimer = undefined;
    }
    if (this.idleTimeouts.has(clientId)) {
      clearTimeout(this.idleTimeouts.get(clientId));
      this.idleTimeouts.delete(clientId);
    }

    if (
      context.conversationHistory &&
      context.conversationHistory.length > 0
    ) {
      try {
        await this.speakingService.saveConversationHistory(
          sessionId,
          context.conversationHistory,
        );
      } catch (err) {
        this.logger.error(
          `Failed to save transcript on immediate close for ${sessionId}: ${(err as Error).message}`,
        );
      }
    }

    this.geminiService.closeLiveSession(sessionId);
    this.sessions.delete(clientId);

    const namespace = this.server?.of?.('speaking');
    const socket = namespace?.sockets?.get(clientId);
    if (socket?.connected) {
      socket.disconnect(true);
    }

    this.logger.log(`Session ${sessionId} closed immediately (gateway + Gemini)`);
  }

  /**
   * Create standardized Gemini callback handlers for a session
   * Used by both initial connection and resume scenarios
   */
  private createGeminiCallbacks(
    client: Socket,
    context: SessionContext,
  ): GeminiSessionCallbacks {
    return {
      onAudioResponse: (response) => {
        if (client.connected) {
          const audioResponsePayload = {
            text: response.text,
            audioData: response.audioData,
            audioMimeType: response.audioMimeType,
            timestamp: new Date().toISOString(),
          };
          this.logger.log(
            `[SpeakingGateway] envoi → client audio_response (client.id=${client.id}): text=${response.text?.length ?? 0} chars, audioData=${response.audioData?.length ?? 0} chars, preview=${(response.text ?? '').slice(0, 80)}${(response.text?.length ?? 0) > 80 ? '...' : ''}`,
          );
          client.emit('audio_response', audioResponsePayload);

          // Record Elena's response in conversation history
          // For audio-only responses, use placeholder to preserve conversation flow
          const responseText = response.text || '[Audio response received]';
          context.conversationHistory.push({
            speaker: 'elena',
            text: responseText,
            timestamp: new Date().toISOString(),
          });
        }
      },
      onInputTranscription: (text) => {
        context.conversationHistory.push({
          speaker: 'student',
          text,
          timestamp: new Date().toISOString(),
        });
        this.logger.debug(
          `Student transcription recorded for session ${context.sessionId}: ${text.slice(0, 80)}${text.length > 80 ? '...' : ''}`,
        );
      },
      onOutputTranscription: (text) => {
        this.logger.debug(
          `Elena output transcription for session ${context.sessionId}: ${text.slice(0, 80)}${text.length > 80 ? '...' : ''}`,
        );
      },
      onError: (error) => {
        this.logger.error(
          `Gemini Live error for session ${context.sessionId}: ${error.message}`,
        );
        if (client.connected) {
          client.emit('gemini_error', {
            code: 'GEMINI_LIVE_ERROR',
            message: error.message,
          });
        }
      },
      onClose: () => {
        this.logger.log(
          `Gemini Live session closed for session ${context.sessionId}`,
        );
      },
    };
  }

  /**
   * Set up timer warnings for countdown milestones
   * Emits time_warning events at 120s, 60s, and 30s remaining
   */
  private setupTimerWarnings(client: Socket, context: SessionContext): void {
    if (!context.timeLimit || !context.expectedEndTime) {
      return;
    }

    const warningThresholds = [120, 60, 30]; // seconds

    warningThresholds.forEach((threshold) => {
      const delay = (context.timeLimit! - threshold) * 1000;

      // Only set warning if threshold hasn't passed yet
      if (delay > 0) {
        const handle = setTimeout(() => {
          // Verify session still exists and client is still connected
          const currentContext = this.sessions.get(client.id);
          if (currentContext && client.connected) {
            const timeWarningPayload = {
              remainingSeconds: threshold,
              sessionId: context.sessionId,
            };
            this.logger.log(
              `[SpeakingGateway] envoi → client time_warning: ${JSON.stringify(timeWarningPayload)}`,
            );
            client.emit('time_warning', timeWarningPayload);
          }
        }, delay);
        context.timerHandles.push(handle);
      }
    });

    this.logger.log(
      `Timer warnings configured for session ${context.sessionId}`,
    );
  }

  /**
   * Set up auto-end timer when session time limit expires
   * Automatically ends session and disconnects client
   */
  private setupAutoEnd(client: Socket, context: SessionContext): void {
    if (!context.timeLimit || !context.expectedEndTime) {
      return;
    }

    const delay = context.timeLimit * 1000;

    const handle = setTimeout(async () => {
      try {
        // Verify session still exists and is not already ended
        const currentContext = this.sessions.get(client.id);
        if (!currentContext) {
          return; // Session already cleaned up
        }

        // Check if session status indicates it's still running
        if (
          currentContext.status !== 'active' &&
          currentContext.status !== 'paused'
        ) {
          return; // Session already ended
        }

        this.logger.log(
          `Timer expired for session ${context.sessionId}, auto-ending session`,
        );

        // Save conversation history before ending
        if (currentContext.conversationHistory.length > 0) {
          await this.speakingService.saveConversationHistory(
            currentContext.sessionId,
            currentContext.conversationHistory,
          );
        }

        // Update database: mark session as completed
        await this.databaseService
          .getClient()
          .from('exam_sessions')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            elapsed_time: context.timeLimit,
          })
          .eq('session_id', context.sessionId);

        // Close Gemini session
        this.geminiService.closeLiveSession(context.sessionId);

        // Notify client
        const sessionEndedPayload = {
          reason: 'timer_expired',
          sessionId: context.sessionId,
          message: 'Session time limit reached',
        };
        this.logger.log(
          `[SpeakingGateway] envoi → client session_ended: ${JSON.stringify(sessionEndedPayload)}`,
        );
        client.emit('session_ended', sessionEndedPayload);

        // Clean up and disconnect
        this.sessions.delete(client.id);
        if (this.idleTimeouts.has(client.id)) {
          clearTimeout(this.idleTimeouts.get(client.id));
          this.idleTimeouts.delete(client.id);
        }

        client.disconnect(true);

        this.logger.log(
          `Session ${context.sessionId} auto-ended due to timer expiry`,
        );
      } catch (error) {
        this.logger.error(
          `Error during auto-end for session ${context.sessionId}: ${error.message}`,
          error.stack,
        );
      }
    }, delay);
    context.timerHandles.push(handle);

    this.logger.log(
      `Auto-end timer set for session ${context.sessionId} (${context.timeLimit}s)`,
    );
  }

  /**
   * Calculate current elapsed seconds for a session
   * Returns snapshot value for non-active states, live calculation for active
   */
  private getElapsedSeconds(context: SessionContext): number {
    if (context.status !== 'active') {
      return context.elapsedSeconds;
    }
    return Math.floor((Date.now() - context.startTime.getTime()) / 1000);
  }

  /**
   * Utility: Validate Base64 string format
   */
  private isValidBase64(str: string): boolean {
    try {
      return Buffer.from(str, 'base64').toString('base64') === str;
    } catch {
      return false;
    }
  }

  /**
   * CRITICAL FIX #3: Lifecycle cleanup to prevent memory leaks
   * Called when NestJS module is destroyed (app shutdown, tests)
   */
  async onModuleDestroy() {
    this.logger.log('Cleaning up SpeakingGateway resources...');

    // Clear all idle timeouts
    for (const timeout of this.idleTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.idleTimeouts.clear();

    // Clear all disconnect and pause timers
    for (const context of this.sessions.values()) {
      if (context.disconnectTimer) {
        clearTimeout(context.disconnectTimer);
      }
      if (context.pauseTimer) {
        clearTimeout(context.pauseTimer);
      }
      // Clear pause Gemini close timer
      if (context.pauseGeminiCloseTimer) {
        clearTimeout(context.pauseGeminiCloseTimer);
      }
      // Clear timer warning and auto-end handles
      if (context.timerHandles) {
        for (const handle of context.timerHandles) {
          clearTimeout(handle);
        }
      }
    }

    // Close all Gemini sessions
    const sessionIds = Array.from(this.sessions.values()).map(
      (c) => c.sessionId,
    );
    for (const sessionId of sessionIds) {
      try {
        this.geminiService.closeLiveSession(sessionId);
      } catch (error) {
        this.logger.error(
          `Error closing Gemini session ${sessionId} during cleanup: ${error.message}`,
        );
      }
    }

    this.sessions.clear();
    this.logger.log('SpeakingGateway cleanup complete');
  }
}
