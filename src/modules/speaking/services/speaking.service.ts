import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../shared/services/prisma.service';
import {
  StartSessionResponseDto,
  PauseSessionResponseDto,
  ResumeSessionResponseDto,
  EndSessionResponseDto,
} from '../dto';
import type { TeilListItemDto, SessionHistoryItemDto } from '../dto';
import { ConversationMessage } from '../interfaces/session.interface';

interface SessionState {
  sessionId: string;
  studentId: string;
  teilNumber: number;
  status: string;
  useTimer: boolean;
  timeLimit: number | null;
  serverStartTime: Date;
  elapsedSeconds: number;
}

/**
 * Service for managing speaking exam sessions
 * Handles all REST operations: start, pause, resume, end
 */
@Injectable()
export class SpeakingService {
  private readonly logger = new Logger(SpeakingService.name);

  // In-memory session state (will be expanded when WebSocket gateway is added)
  private sessionStates: Map<string, SessionState> = new Map();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Endpoint 1: POST /api/speaking/session/start
   * Create a new exam session
   */
  async startSession(
    studentId: string,
    teilNumber: number,
    useTimer: boolean,
  ): Promise<StartSessionResponseDto> {
    try {
      this.logger.log(
        `Starting new speaking session for student ${studentId}, Teil ${teilNumber}`,
      );

      // Validate Teil number
      if (![1, 2, 3].includes(teilNumber)) {
        throw new BadRequestException('INVALID_TEIL_NUMBER');
      }

      // If student already has an active/paused session, close it so a new one can start
      const existingSession = await this.prisma.examSession.findFirst({
        where: { student_id: studentId, status: { in: ['active', 'paused'] } },
        select: { session_id: true, status: true },
      });

      if (existingSession) {
        this.logger.log(
          `Closing existing session ${existingSession.session_id} (status: ${existingSession.status}) before starting new one for student ${studentId}`,
        );
        await this.prisma.examSession.update({
          where: { session_id: existingSession.session_id },
          data: { status: 'interrupted', completed_at: new Date() },
        });
      }

      // Determine time limit based on Teil
      const timeLimitMap: Record<number, number> = {
        1: 240, // 4 minutes
        2: 360, // 6 minutes
        3: 360, // 6 minutes
      };

      const timeLimit = useTimer ? timeLimitMap[teilNumber] : null;
      const serverStartTime = new Date();

      // Create session in database
      let sessionId: string;
      try {
        const session = await this.prisma.examSession.create({
          data: {
            student_id: studentId,
            teil_number: teilNumber,
            status: 'active',
            use_timer: useTimer,
            time_limit_seconds: timeLimit,
            server_start_time: serverStartTime,
            elapsed_time: 0,
          },
          select: { session_id: true },
        });
        sessionId = session.session_id;
      } catch (err) {
        this.logger.error(`Failed to create exam session: ${(err as Error).message}`);
        throw new BadRequestException('FAILED_TO_CREATE_SESSION');
      }

      // Store in-memory state for WebSocket integration
      this.sessionStates.set(sessionId, {
        sessionId,
        studentId,
        teilNumber,
        status: 'active',
        useTimer,
        timeLimit,
        serverStartTime,
        elapsedSeconds: 0,
      });

      // Get Teil-specific instructions
      const teilInstructions = this.getTeilInstructions(teilNumber);

      return {
        sessionId,
        teilNumber,
        useTimer,
        serverStartTime: serverStartTime.toISOString(),
        timeLimit,
        teilInstructions,
      };
    } catch (error) {
      this.logger.error(`Error starting session: ${error.message}`);
      throw error;
    }
  }

  /**
   * Endpoint 2: PATCH /api/speaking/session/:sessionId/pause
   * Pause an active session
   *
   * @deprecated Use WebSocket 'pause_session' event instead.
   * This method only updates database status and does NOT manage Gemini lifecycle.
   */
  async pauseSession(
    sessionId: string,
    studentId: string,
  ): Promise<PauseSessionResponseDto> {
    try {
      this.logger.log(`Pausing session ${sessionId}`);

      // Verify session exists and belongs to student
      const session = await this.prisma.examSession.findFirst({
        where: { session_id: sessionId, student_id: studentId },
        select: { session_id: true, status: true, server_start_time: true, time_limit_seconds: true, use_timer: true },
      });

      if (!session) {
        throw new NotFoundException('SESSION_NOT_FOUND');
      }

      if (session.status !== 'active') {
        throw new BadRequestException(
          `CANNOT_PAUSE_SESSION_WITH_STATUS_${session.status.toUpperCase()}`,
        );
      }

      // Calculate elapsed time
      const startTime = session.server_start_time as Date;
      const now = new Date();
      const elapsedSeconds = Math.floor(
        (now.getTime() - startTime.getTime()) / 1000,
      );

      // Update session in database
      try {
        await this.prisma.examSession.update({
          where: { session_id: sessionId },
          data: { status: 'paused', pause_timestamp: now, elapsed_time: elapsedSeconds },
        });
      } catch {
        throw new BadRequestException('FAILED_TO_PAUSE_SESSION');
      }

      // Update in-memory state
      const sessionState = this.sessionStates.get(sessionId);
      if (sessionState) {
        sessionState.status = 'paused';
        sessionState.elapsedSeconds = elapsedSeconds;
      }

      // Calculate remaining time
      let remainingSeconds: number | null = null;
      if (session.use_timer && session.time_limit_seconds) {
        remainingSeconds = Math.max(
          0,
          session.time_limit_seconds - elapsedSeconds,
        );
      }

      return {
        status: 'paused',
        pausedAt: now.toISOString(),
        elapsedSeconds,
        remainingSeconds,
      };
    } catch (error) {
      this.logger.error(`Error pausing session: ${error.message}`);
      throw error;
    }
  }

  /**
   * Endpoint 3: PATCH /api/speaking/session/:sessionId/resume
   * Resume a paused session
   *
   * @deprecated Use WebSocket 'resume_session' event instead.
   * This method only updates database status and does NOT re-initialize Gemini if closed.
   */
  async resumeSession(
    sessionId: string,
    studentId: string,
  ): Promise<ResumeSessionResponseDto> {
    try {
      this.logger.log(`Resuming session ${sessionId}`);

      // Verify session exists and belongs to student
      const session = await this.prisma.examSession.findFirst({
        where: { session_id: sessionId, student_id: studentId },
        select: { session_id: true, status: true, pause_timestamp: true, elapsed_time: true, time_limit_seconds: true, use_timer: true },
      });

      if (!session) {
        throw new NotFoundException('SESSION_NOT_FOUND');
      }

      if (session.status !== 'paused') {
        throw new BadRequestException(
          `CANNOT_RESUME_SESSION_WITH_STATUS_${session.status.toUpperCase()}`,
        );
      }

      // Calculate pause duration
      const pauseTime = session.pause_timestamp as Date;
      const now = new Date();
      const pauseDuration = Math.floor(
        (now.getTime() - pauseTime.getTime()) / 1000,
      );

      // Update session in database
      try {
        await this.prisma.examSession.update({
          where: { session_id: sessionId },
          data: { status: 'active', pause_timestamp: null },
        });
      } catch {
        throw new BadRequestException('FAILED_TO_RESUME_SESSION');
      }

      // Update in-memory state
      const sessionState = this.sessionStates.get(sessionId);
      if (sessionState) {
        sessionState.status = 'active';
      }

      // Calculate remaining time
      let remainingSeconds: number | null = null;
      if (session.use_timer && session.time_limit_seconds) {
        // Total elapsed = previous elapsed + pause duration
        const totalElapsed = (session.elapsed_time ?? 0) + pauseDuration;
        remainingSeconds = Math.max(
          0,
          session.time_limit_seconds - totalElapsed,
        );
      }

      return {
        status: 'active',
        resumedAt: now.toISOString(),
        remainingSeconds,
      };
    } catch (error) {
      this.logger.error(`Error resuming session: ${error.message}`);
      throw error;
    }
  }

  /**
   * Endpoint 4: POST /api/speaking/session/:sessionId/end
   * End a session and return summary
   */
  async endSession(
    sessionId: string,
    studentId: string,
    reason?: 'completed' | 'cancelled',
    conversationHistory?: ConversationMessage[],
  ): Promise<EndSessionResponseDto> {
    try {
      this.logger.log(
        `Ending session ${sessionId}, reason: ${reason || 'not specified'}`,
      );

      // Verify session exists and belongs to student
      const session = await this.prisma.examSession.findFirst({
        where: { session_id: sessionId, student_id: studentId },
        select: { session_id: true, status: true, server_start_time: true, elapsed_time: true, use_timer: true, time_limit_seconds: true, pause_timestamp: true, teil_number: true },
      });

      if (!session) {
        throw new NotFoundException('SESSION_NOT_FOUND');
      }

      // Calculate final elapsed time
      const startTime = session.server_start_time as Date;
      const now = new Date();
      let totalElapsedSeconds = Math.floor(
        (now.getTime() - startTime.getTime()) / 1000,
      );

      // If session is currently paused, add the pause time to elapsed
      if (session.status === 'paused' && session.pause_timestamp) {
        const pauseTime = session.pause_timestamp as Date;
        const pausedDurationSeconds = Math.floor(
          (now.getTime() - pauseTime.getTime()) / 1000,
        );
        // Don't count the pause duration that happened after pausing
        totalElapsedSeconds = (session.elapsed_time ?? 0) + pausedDurationSeconds;
      }

      // Determine if evaluable (minimum 120 seconds = 2 minutes)
      const isEvaluable = totalElapsedSeconds >= 120;

      // Update session in database
      try {
        await this.prisma.examSession.update({
          where: { session_id: sessionId },
          data: {
            status: reason === 'cancelled' ? 'cancelled' : 'completed',
            completed_at: now,
            elapsed_time: totalElapsedSeconds,
          },
        });
      } catch {
        throw new BadRequestException('FAILED_TO_END_SESSION');
      }

      // Clean up in-memory state
      this.sessionStates.delete(sessionId);

      // Save conversation history to database if provided
      if (conversationHistory && conversationHistory.length > 0) {
        await this.saveTranscript(sessionId, conversationHistory);
      }

      // Calculate message and word count
      // If conversationHistory was provided, use it; otherwise fetch from DB
      let messageCount = 0;
      let wordCount = 0;

      if (conversationHistory && conversationHistory.length > 0) {
        messageCount = conversationHistory.length;
        wordCount = conversationHistory.reduce((count, msg) => {
          return count + msg.text.split(/\s+/).filter(Boolean).length;
        }, 0);
      } else {
        // Fetch from teil_transcripts if session was ended via REST without history
        const transcript = await this.prisma.teilTranscript.findFirst({
          where: { session_id: sessionId },
          select: { word_count: true, conversation_history: true },
        });

        if (transcript) {
          wordCount = transcript.word_count ?? 0;
          messageCount = Array.isArray(transcript.conversation_history)
            ? transcript.conversation_history.length
            : 0;
        }
      }

      return {
        duration: totalElapsedSeconds,
        wordCount,
        messageCount,
        isEvaluable,
      };
    } catch (error) {
      this.logger.error(`Error ending session: ${error.message}`);
      throw error;
    }
  }

  /**
   * GET /api/speaking/teils
   * Return the list of 3 Teils (metadata for list/detail screens).
   * Data in code; frontend maps to SpeakingExerciseType.
   */
  getTeils(): TeilListItemDto[] {
    const teils: TeilListItemDto[] = [
      {
        id: 1,
        part: 1,
        title: 'Lire à voix haute',
        subtitle: 'Lisez la phrase affichée à voix haute.',
        topicTitle: 'Aufgabe: Stellen Sie sich vor',
        topicDescription:
          'Sprechen Sie über sich. Gehen Sie auf die folgenden Punkte ein. Bilden Sie vollständige Sätze.',
        topicPoints: [
          'Name',
          'Alter',
          'Land & Wohnort',
          'Sprachen',
          'Beruf',
          'Hobby',
        ],
        durationMinutes: 10,
        prepDurationSeconds: 300,
        imagePath: 'assets/images/modules/sprechen.jpg',
        examImagePath: null,
        instructions:
          'In this Teil, Elena will ask you about your personal life including your name, where you are from, your hobbies and interests, and your work or studies. Speak naturally and clearly.',
      },
      {
        id: 2,
        part: 2,
        title: 'Dialogue',
        subtitle: 'Pratiquez des échanges courts en situation.',
        topicTitle: 'Aufgabe: Bildbeschreibung',
        topicDescription:
          'Beschreiben Sie das Bild genau. Was sehen Sie? Wie ist die Situation?',
        topicPoints: [
          'Was sehen Sie auf dem Foto?',
          'Was machen die Personen?',
          'Wie ist die Umgebung/Wetter?',
          'Ihre persönliche Meinung zum Thema.',
        ],
        durationMinutes: 15,
        prepDurationSeconds: 300,
        imagePath: 'assets/images/modules/sprechen.jpg',
        examImagePath: 'assets/images/modules/sprechen.jpg',
        instructions:
          'In this Teil, Elena will present you with a topic and ask for your opinion and experiences. Share your thoughts elaborately and give concrete examples.',
      },
      {
        id: 3,
        part: 3,
        title: 'Répétition',
        subtitle: "Répétez la phrase après l'écoute.",
        topicTitle: 'Aufgabe: Ein Abschiedsfest planen',
        topicDescription:
          'Ihr Kollege Patrick verlässt die Firma. Sie möchten mit Ihrer Partnerin eine Überraschungsparty organisieren.',
        topicPoints: [
          'Wann feiern?',
          'Wo feiern?',
          'Essen und Trinken?',
          'Geschenk für Patrick?',
          'Wer wird eingeladen?',
        ],
        durationMinutes: 5,
        prepDurationSeconds: 300,
        imagePath: 'assets/images/modules/sprechen.jpg',
        examImagePath: null,
        instructions:
          'In this Teil, Elena will present a debatable topic with different viewpoints. Take a position and defend it with arguments. Be prepared to explain your reasoning.',
      },
    ];
    return teils;
  }

  /**
   * GET /api/speaking/sessions
   * Return history of speaking sessions (and evaluations) for the authenticated student.
   */
  async getSessions(
    studentId: string,
    teilNumber?: number,
    limit = 50,
  ): Promise<SessionHistoryItemDto[]> {
    try {
      const rows = await this.prisma.examSession.findMany({
        where: {
          student_id: studentId,
          status: { in: ['completed', 'interrupted'] },
          completed_at: { not: null },
          ...(teilNumber !== undefined && teilNumber >= 1 && teilNumber <= 3
            ? { teil_number: teilNumber }
            : {}),
        },
        include: { teil_evaluations: { select: { overall_score: true, strengths: true, areas_for_improvement: true } } },
        orderBy: { completed_at: 'desc' },
        take: limit,
      });

      return rows.map((row) => {
        const evalRow = row.teil_evaluations[0];
        return {
          sessionId: row.session_id,
          teilNumber: row.teil_number,
          completedAt: (row.completed_at as Date)?.toISOString() ?? '',
          overallScore: evalRow?.overall_score ?? null,
          strengths: evalRow?.strengths ?? null,
          areasForImprovement: evalRow?.areas_for_improvement ?? null,
        };
      });
    } catch (err) {
      this.logger.error(`Error in getSessions: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * Get Teil-specific instructions for display to student
   */
  private getTeilInstructions(teilNumber: number): string {
    const instructions: Record<number, string> = {
      1: 'In this Teil, Elena will ask you about your personal life including your name, where you are from, your hobbies and interests, and your work or studies. Speak naturally and clearly.',
      2: 'In this Teil, Elena will present you with a topic and ask for your opinion and experiences. Share your thoughts elaborately and give concrete examples.',
      3: 'In this Teil, Elena will present a debatable topic with different viewpoints. Take a position and defend it with arguments. Be prepared to explain your reasoning.',
    };

    return instructions[teilNumber] || '';
  }

  /**
   * Get session state (used by WebSocket gateway)
   */
  getSessionState(sessionId: string): SessionState | undefined {
    return this.sessionStates.get(sessionId);
  }

  /**
   * Update session state (used by WebSocket gateway)
   */
  updateSessionState(sessionId: string, updates: Partial<SessionState>): void {
    const current = this.sessionStates.get(sessionId);
    this.sessionStates.set(sessionId, {
      ...current,
      ...updates,
    } as SessionState);
  }

  /**
   * Remove session state on cleanup
   */
  removeSessionState(sessionId: string): void {
    this.sessionStates.delete(sessionId);
  }

  /**
   * Save conversation transcript to database
   * Called when session ends with conversation history
   */
  private async saveTranscript(
    sessionId: string,
    conversationHistory: ConversationMessage[],
  ): Promise<void> {
    try {
      this.logger.log(
        `Saving transcript for session ${sessionId} (${conversationHistory.length} messages)`,
      );

      // Build transcript text from conversation history
      const transcriptText = conversationHistory
        .map((msg) => `${msg.speaker}: ${msg.text}`)
        .join('\n');

      const wordCount = conversationHistory.reduce((count, msg) => {
        return count + msg.text.split(/\s+/).filter(Boolean).length;
      }, 0);

      const existing = await this.prisma.teilTranscript.findFirst({
        where: { session_id: sessionId },
        select: { id: true },
      });

      const transcriptData = {
        transcript_text: transcriptText,
        conversation_history: conversationHistory as object[],
        word_count: wordCount,
      };

      if (existing) {
        await this.prisma.teilTranscript.update({ where: { id: existing.id }, data: transcriptData });
      } else {
        await this.prisma.teilTranscript.create({ data: { session_id: sessionId, ...transcriptData } });
      }

      this.logger.log(`Transcript saved successfully for session ${sessionId}`);
    } catch (error) {
      this.logger.error(
        `Error saving transcript: ${error.message}`,
        error.stack,
      );
      // Swallow error - not critical for session end
    }
  }

  /**
   * Save conversation history for a session (called by WebSocket gateway)
   * Public method for gateway to save transcript when session is interrupted
   */
  async saveConversationHistory(
    sessionId: string,
    conversationHistory: ConversationMessage[],
  ): Promise<void> {
    try {
      await this.saveTranscript(sessionId, conversationHistory);
    } catch (error) {
      this.logger.error(
        `Error in saveConversationHistory: ${error.message}`,
        error.stack,
      );
    }
  }
}
