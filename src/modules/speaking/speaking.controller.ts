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
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { GuestBlockGuard } from '../../shared/guards/guest-block.guard';
import { EvaluationService } from './services';
import { EvaluateSpeakingDto, SpeakingEvaluationResponseDto } from './dto';

@ApiTags('Speaking')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@ApiForbiddenResponse({
  description: 'Guest accounts cannot use Speaking (messageKey: guestNotAllowed)',
})
@UseGuards(JwtAuthGuard, GuestBlockGuard)
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
    @Request() req: any,
    @Body() dto: EvaluateSpeakingDto,
  ): Promise<SpeakingEvaluationResponseDto> {
    this.logger.log(
      `Evaluate request — student: ${req.student?.studentId}, Teil: ${dto.teilNumber}, ` +
        `transcript length: ${dto.transcript.length} chars`,
    );

    return this.evaluationService.evaluateTranscript(dto.teilNumber, dto.transcript);
  }
}
