import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Logger,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { AccessTokenPayload } from '../../../shared/interfaces/token-payload.interface';
import { SpeakingService } from '../services/speaking.service';
import { GeminiService } from '../services/gemini.service';
import {
  ExaminerPromptService,
  ExaminerTopic,
} from './examiner-prompt.service';
import { LiveSessionLimitService } from './live-session-limit.service';
import { CreateLiveTokenDto } from './dto/create-live-token.dto';
import { EndLiveSessionDto } from './dto/end-live-session.dto';
import { LiveTokenResponseDto } from './dto/live-token-response.dto';

/**
 * Issues the credential for a live spoken session with Elena.
 *
 * Deliberately NOT behind GuestBlockGuard. The demo has no login — the Flutter
 * app mints a guest JWT from POST /api/auth/guest on first load — so blocking
 * guests here would block every real user. Spend is controlled by
 * {@link LiveSessionLimitService} instead, which caps guests by IP because a
 * guest studentId can be re-rolled at will.
 */
@ApiTags('Speaking')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@UseGuards(JwtAuthGuard)
@Controller('api/speaking')
export class LiveTokenController {
  private readonly logger = new Logger(LiveTokenController.name);

  constructor(
    private readonly speakingService: SpeakingService,
    private readonly geminiService: GeminiService,
    private readonly promptService: ExaminerPromptService,
    private readonly limitService: LiveSessionLimitService,
  ) {}

  @Post('live-token')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Mint an ephemeral token for a live session with Elena',
    description:
      'Returns a single-use Gemini token locked to the live model, audio-only ' +
      'output and the Teil system instruction. The browser connects directly ' +
      'to Google with it; no audio passes through this backend. Available to ' +
      'guest accounts, capped per IP per day.',
  })
  @ApiCreatedResponse({ type: LiveTokenResponseDto })
  @ApiTooManyRequestsResponse({
    description:
      'A cap was hit. messageKey is one of elenaDailyLimit, elenaBusyToday, ' +
      'elenaBusyNow — each maps to a different message and all offer the human room.',
  })
  async createLiveToken(
    @Ip() ip: string,
    @Request() req: { student?: AccessTokenPayload },
    @Body() dto: CreateLiveTokenDto,
  ): Promise<LiveTokenResponseDto> {
    const sessionId = randomUUID();

    await this.limitService.acquire(
      {
        ip: ip || 'unknown',
        studentId: req.student?.studentId,
        isGuest: req.student?.isGuest === true,
      },
      sessionId,
    );

    const topic = await this.loadTopic(dto.teilNumber, dto.modelltest ?? 1);
    const instruction = this.promptService.build(dto.teilNumber, topic);
    const sessionSeconds = this.limitService.sessionSeconds;

    const { token, model } = await this.geminiService.mintLiveToken(
      instruction,
      sessionSeconds,
    );

    this.logger.log(
      JSON.stringify({
        event: 'elena.token.minted',
        sessionId,
        teil: dto.teilNumber,
        model,
        hasTopic: topic !== null,
      }),
    );

    return {
      sessionId,
      token,
      model,
      expiresInSeconds: sessionSeconds,
      teilNumber: dto.teilNumber,
      ...(topic ? { topic } : {}),
    };
  }

  @Post('live-session/end')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Release a live session slot early',
    description:
      'Call when the conversation ends. The pool of concurrent sessions is ' +
      'otherwise TTL-driven — the backend never learns that a ' +
      'browser-to-Google session finished — so a two-minute conversation ' +
      'would hold a slot for the full session ceiling and keep others out. ' +
      'Idempotent, and always 204: an unknown or already-released id is not ' +
      'reported, so this cannot be used to probe which sessions exist.',
  })
  @ApiNoContentResponse({ description: 'Slot released, or was not held' })
  async endLiveSession(@Body() dto: EndLiveSessionDto): Promise<void> {
    await this.limitService.release(dto.sessionId);
  }

  /**
   * A missing or unseeded Modelltest must not stop someone practising: Elena's
   * base persona already tells her to introduce a topic herself. So a lookup
   * failure is logged and downgraded to "no topic", never surfaced as an error.
   */
  private async loadTopic(
    teilNumber: number,
    modelltest: number,
  ): Promise<ExaminerTopic | null> {
    try {
      const teils = await this.speakingService.getTeils(modelltest);
      const match = teils.find((teil) => teil.part === teilNumber);
      if (!match) return null;

      return {
        title: match.topicTitle,
        description: match.topicDescription,
        points: match.topicPoints,
      };
    } catch (error) {
      this.logger.warn(
        `No topic for Teil ${teilNumber} of Modelltest ${modelltest}: ` +
          `${(error as Error).message}. Continuing without one.`,
      );
      return null;
    }
  }
}
