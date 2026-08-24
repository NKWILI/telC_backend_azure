import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  BadRequestException,
  Ip,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
  ApiTooManyRequestsResponse,
  ApiQuery,
  ApiParam,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { StudentSubscriptionGuard } from '../../shared/guards/student-subscription.guard';
import { CurrentStudent } from '../../shared/decorators/current-student.decorator';
import { AccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { WritingService } from './writing.service';
import { RateLimitService } from '../../shared/services/rate-limit.service';
import { ExerciseAttemptDto, WritingExerciseDto } from './dto';
import { SubmitWritingDto } from './dto/submit-writing.dto';
import { SubmitWritingResponseDto } from './dto/submit-writing-response.dto';

@ApiTags('Writing')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@UseGuards(JwtAuthGuard, StudentSubscriptionGuard)
@Controller('api/writing')
export class WritingController {
  constructor(
    private readonly writingService: WritingService,
    private readonly rateLimitService: RateLimitService,
  ) {}

  @Get('exercise')
  @ApiOperation({
    summary: 'Get the writing exercise for a given Modelltest number',
    description:
      'Returns the full exercise content for the given Modelltest. ' +
      'Use this instead of GET /exercise/:id — no UUID needed by the frontend.',
  })
  @ApiQuery({
    name: 'modelltest',
    required: true,
    description: 'Modelltest number (e.g. 1)',
    example: 1,
  })
  @ApiOkResponse({ type: WritingExerciseDto })
  @ApiNotFoundResponse({
    description: 'No writing exercise found for this Modelltest',
  })
  @ApiBadRequestResponse({
    description: 'modelltest query param is missing or not a number',
  })
  async getExerciseByModelltest(
    @Query('modelltest') modelltest: string,
  ): Promise<WritingExerciseDto> {
    const number = parseInt(modelltest, 10);
    if (!modelltest || isNaN(number)) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: 'modelltest query param is required and must be a number',
        messageKey: 'writingMissingModelltest',
      });
    }
    return this.writingService.getExerciseByModelltest(number);
  }

  @Get('exercise/:id')
  @ApiOperation({
    summary: 'Get a writing exercise by UUID',
    description:
      'Returns the full exercise content (stimulus, task instructions, bullet points). ' +
      'Obtain the UUID from GET /api/modelltests/:number → exercises.writing[0].',
  })
  @ApiParam({
    name: 'id',
    description: 'Exercise UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiOkResponse({ type: WritingExerciseDto })
  @ApiNotFoundResponse({ description: 'Exercise not found' })
  async getExercise(@Param('id') id: string): Promise<WritingExerciseDto> {
    return this.writingService.getExercise(id);
  }

  @Get('sessions')
  @ApiOperation({
    summary: 'List past writing attempts for the authenticated student',
    description:
      'Returns up to 50 attempts, newest first. Optionally filter by exercise UUID.',
  })
  @ApiQuery({
    name: 'exerciseId',
    required: false,
    description: 'Filter by exercise UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiOkResponse({ type: [ExerciseAttemptDto] })
  async getSessions(
    @CurrentStudent() student: AccessTokenPayload | null,
    @Query('exerciseId') exerciseId?: string,
  ): Promise<ExerciseAttemptDto[]> {
    const studentId = student?.studentId;
    if (!studentId) return [];
    return this.writingService.getSessions(studentId, exerciseId);
  }

  @Post('submit')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Submit a writing attempt for AI correction',
    description:
      'Creates a pending attempt and queues async AI correction. ' +
      'Listen on the WebSocket namespace /writing for the correction_ready event.',
  })
  @ApiCreatedResponse({
    type: SubmitWritingResponseDto,
    description: 'Attempt accepted and queued for correction',
  })
  @ApiNotFoundResponse({ description: 'Exercise UUID not found' })
  @ApiTooManyRequestsResponse({
    description:
      'Rate limit exceeded. Guests are capped at 3 submissions per IP per hour; ' +
      'registered students have a higher per-account limit.',
  })
  async submit(
    @CurrentStudent() student: AccessTokenPayload | null,
    @Body() dto: SubmitWritingDto,
    @Ip() ip: string,
  ): Promise<SubmitWritingResponseDto> {
    const studentId = student?.studentId;
    if (!studentId) {
      throw new UnauthorizedException('INVALID_ACCESS_TOKEN');
    }
    if (student.isGuest === true) {
      await this.rateLimitService.checkWritingGuestSubmitLimit(ip || 'unknown');
    } else {
      await this.rateLimitService.checkWritingSubmitLimit(studentId);
    }
    return this.writingService.submit(studentId, dto);
  }
}
