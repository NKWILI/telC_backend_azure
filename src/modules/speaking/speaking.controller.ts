import {
  Controller,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  Request,
  BadRequestException,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { AccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { SpeakingService, EvaluationService } from './services';
import {
  StartSessionDto,
  StartSessionResponseDto,
  PauseSessionResponseDto,
  ResumeSessionResponseDto,
  EndSessionResponseDto,
  EndSessionDto,
  EvaluationResponseDto,
} from './dto';

/**
 * Speaking Exam Controller
 * Handles REST endpoints for SPRECHEN module
 * All endpoints require JWT authentication
 */
@UseGuards(JwtAuthGuard)
@Controller('api/speaking/session')
export class SpeakingController {
  private readonly logger = new Logger(SpeakingController.name);

  constructor(
    private readonly speakingService: SpeakingService,
    private readonly evaluationService: EvaluationService,
  ) {}

  /**
   * POST /api/speaking/session/start
   * Create a new speaking exam session
   *
   * Authorization: JWT required via @UseGuards(JwtAuthGuard)
   * Ownership: Session automatically created for authenticated student from token
   */
  @Post('start')
  @HttpCode(HttpStatus.CREATED)
  async startSession(
    @Request() req: any,
    @Body() dto: StartSessionDto,
  ): Promise<StartSessionResponseDto> {
    try {
      const studentPayload: AccessTokenPayload = req.student;

      this.logger.log(
        `Starting session for student ${studentPayload.studentId}, Teil ${dto.teilNumber}, useTimer: ${dto.useTimer}`,
      );

      const response = await this.speakingService.startSession(
        studentPayload.studentId,
        dto.teilNumber,
        dto.useTimer,
      );

      return response;
    } catch (error) {
      this.logger.error(`Error starting session: ${error.message}`);
      throw error;
    }
  }

  /**
   * PATCH /api/speaking/session/:sessionId/pause
   * Pause an active session
   *
   * Authorization: JWT required via @UseGuards(JwtAuthGuard)
   * Ownership: Verified in service layer (speakingService.pauseSession)
   */
  /**
   * @deprecated Use WebSocket 'pause_session' event instead.
   * This REST endpoint only updates DB status and does NOT manage Gemini lifecycle.
   */
  @Patch(':sessionId/pause')
  @HttpCode(HttpStatus.OK)
  async pauseSession(
    @Request() req: any,
    @Param('sessionId') sessionId: string,
  ): Promise<PauseSessionResponseDto> {
    try {
      const studentPayload: AccessTokenPayload = req.student;

      this.logger.warn(
        `DEPRECATED: REST pause called for session ${sessionId}. ` +
        `Client should use WebSocket 'pause_session' event for proper Gemini management.`,
      );

      const response = await this.speakingService.pauseSession(
        sessionId,
        studentPayload.studentId,
      );

      return response;
    } catch (error) {
      this.logger.error(`Error pausing session: ${error.message}`);
      throw error;
    }
  }

  /**
   * PATCH /api/speaking/session/:sessionId/resume
   * Resume a paused session
   *
   * Authorization: JWT required via @UseGuards(JwtAuthGuard)
   * Ownership: Verified in service layer (speakingService.resumeSession)
   */
  /**
   * @deprecated Use WebSocket 'resume_session' event instead.
   * This REST endpoint only updates DB status and does NOT re-initialize Gemini if closed.
   */
  @Patch(':sessionId/resume')
  @HttpCode(HttpStatus.OK)
  async resumeSession(
    @Request() req: any,
    @Param('sessionId') sessionId: string,
  ): Promise<ResumeSessionResponseDto> {
    try {
      const studentPayload: AccessTokenPayload = req.student;

      this.logger.warn(
        `DEPRECATED: REST resume called for session ${sessionId}. ` +
        `Client should use WebSocket 'resume_session' event for proper Gemini management.`,
      );

      const response = await this.speakingService.resumeSession(
        sessionId,
        studentPayload.studentId,
      );

      return response;
    } catch (error) {
      this.logger.error(`Error resuming session: ${error.message}`);
      throw error;
    }
  }

  /**
   * POST /api/speaking/session/:sessionId/end
   * End a session
   *
   * Authorization: JWT required via @UseGuards(JwtAuthGuard)
   * Ownership: Verified in service layer (speakingService.endSession)
   */
  @Post(':sessionId/end')
  @HttpCode(HttpStatus.OK)
  async endSession(
    @Request() req: any,
    @Param('sessionId') sessionId: string,
    @Body() dto?: EndSessionDto,
  ): Promise<EndSessionResponseDto> {
    try {
      const studentPayload: AccessTokenPayload = req.student;

      this.logger.log(
        `Ending session ${sessionId} for student ${studentPayload.studentId}, reason: ${dto?.reason || 'not specified'}`,
      );

      const response = await this.speakingService.endSession(
        sessionId,
        studentPayload.studentId,
        dto?.reason,
      );

      return response;
    } catch (error) {
      this.logger.error(`Error ending session: ${error.message}`);
      throw error;
    }
  }

  /**
   * POST /api/speaking/session/:sessionId/evaluate
   * Evaluate a completed speaking session using Gemini AI
   *
   * Authorization: JWT required via @UseGuards(JwtAuthGuard)
   * Ownership: Verified via session lookup (student must own the session)
   * Precondition: Session must be 'completed' or 'interrupted'
   */
  @Post(':sessionId/evaluate')
  @HttpCode(HttpStatus.OK)
  async evaluateSession(
    @Request() req: any,
    @Param('sessionId') sessionId: string,
  ): Promise<EvaluationResponseDto> {
    try {
      const studentPayload: AccessTokenPayload = req.student;

      this.logger.log(
        `Evaluating session ${sessionId} for student ${studentPayload.studentId}`,
      );

      const evaluation = await this.evaluationService.evaluateSession(
        sessionId,
        studentPayload.studentId,
      );

      return evaluation;
    } catch (error) {
      this.logger.error(`Error evaluating session: ${error.message}`);
      throw error;
    }
  }
}
