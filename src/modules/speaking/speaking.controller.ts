import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { GuestBlockGuard } from '../../shared/guards/guest-block.guard';
import { StudentSubscriptionGuard } from '../../shared/guards/student-subscription.guard';
import { EvaluationService } from './services';
import { EvaluateSpeakingDto, SpeakingEvaluationResponseDto } from './dto';

@ApiTags('Speaking')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
/**
 * `GuestBlockGuard` is what the guest-session contract already promised and
 * nothing enforced: `POST /api/auth/guest` documents that Speaking returns 403
 * for a guest, and the guard was written for exactly that and mounted on no
 * route at all.
 *
 * It matters more than a broken promise. A guest token carries a random uuid
 * and no `students` row, `ai_usage.student_id` is a foreign key to that table,
 * and `recordDelivered` swallows the resulting failure by design — so a guest
 * could run paid Gemini evaluations that were never counted, with no
 * credentials and no upper bound. `AiQuotaService` now refuses anything it
 * cannot meter as well, so the hole is closed twice: once at the door, once
 * at the meter.
 */
@UseGuards(JwtAuthGuard, GuestBlockGuard, StudentSubscriptionGuard)
@Controller('api/speaking')
export class SpeakingController {
  private readonly logger = new Logger(SpeakingController.name);

  constructor(private readonly evaluationService: EvaluationService) {}

  /**
   * POST /api/speaking/evaluate
   * Accepts a student transcript and returns an AI evaluation.
   * The frontend records + transcribes audio locally, then submits the text here.
   * The returned evaluationText is a German paragraph ready for TTS playback.
   */
  @Post('evaluate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Evaluate a speaking transcript',
    description:
      'Submit a student transcript. Returns scores (grammar, vocabulary, coherence, overall), ' +
      'a spoken German evaluation paragraph for TTS, and up to 10 corrections.',
  })
  @ApiOkResponse({ type: SpeakingEvaluationResponseDto })
  async evaluate(
    // Typed rather than `any`, because the student id read from it decides
    // whose allowance is spent. `JwtAuthGuard` is what puts it there.
    @Request() req: { student?: { studentId?: string } },
    @Body() dto: EvaluateSpeakingDto,
  ): Promise<SpeakingEvaluationResponseDto> {
    this.logger.log(
      `Evaluate request — student: ${req.student?.studentId}, Teil: ${dto.teilNumber}, ` +
        `transcript length: ${dto.transcript.length} chars`,
    );

    // The student comes from the token, never from the body: a caller able to
    // name the student would spend someone else's allowance.
    return this.evaluationService.evaluateTranscript(
      req.student?.studentId,
      dto.teilNumber,
      dto.transcript,
      {
        attemptId: dto.attemptId,
        durationSeconds: dto.durationSeconds,
        modelltestNumber: dto.modelltestNumber,
      },
    );
  }
}
