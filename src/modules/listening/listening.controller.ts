import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { CurrentStudent } from '../../shared/decorators/current-student.decorator';
import { AccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { ListeningService } from './listening.service';
import type { ExerciseTypeDto } from '../writing/dto/exercise-type.dto';
import { ExerciseAttemptDto } from '../writing/dto/exercise-attempt.dto';
import { ListeningExerciseDto } from './dto/listening-exercise.dto';
import { SubmitListeningDto } from './dto/submit-listening.dto';
import { SubmitListeningResponseDto } from './dto/submit-listening-response.dto';

@ApiTags('Listening (Hören)')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@UseGuards(JwtAuthGuard)
@Controller('api/listening')
export class ListeningController {
  constructor(private readonly listeningService: ListeningService) {}

  @Get('teils')
  @ApiOperation({
    summary: 'List the 3 Hören Teile',
    description:
      'Returns all 3 exercise types with title, image URL, instructions, and per-student progress. ' +
      'Progress is 0 (not yet attempted) or 100 (at least one completed attempt).',
  })
  @ApiOkResponse({
    description: 'Array of 3 Hören Teile',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id:              { type: 'string', example: '1' },
          title:           { type: 'string', example: 'Teil 1' },
          subtitle:        { type: 'string', example: 'Hörverstehen, Teil 1' },
          prompt:          { type: 'string', example: 'Sie hören die Aussagen von fünf Personen...' },
          imagePath:       { type: 'string', example: 'https://pub-9c97adaccfb94d4bb515056232bed4f8.r2.dev/hoerverstehen_teil1.png' },
          progress:        { type: 'number', example: 0 },
          part:            { type: 'number', example: 1 },
          durationMinutes: { type: 'number', example: 10 },
        },
      },
    },
  })
  async getTeils(
    @CurrentStudent() student: AccessTokenPayload | null,
  ): Promise<ExerciseTypeDto[]> {
    if (!student?.studentId) return [];
    return this.listeningService.getTeils(student.studentId);
  }

  @Get('sessions')
  @ApiOperation({
    summary: 'List past Hören attempts',
    description: 'Returns up to 50 attempts, newest first. Optionally filter by Teil number.',
  })
  @ApiQuery({
    name: 'teilNumber',
    required: false,
    description: 'Filter by Teil (1, 2, or 3)',
    example: 1,
  })
  @ApiOkResponse({ description: 'Array of past attempts', type: [ExerciseAttemptDto] })
  async getSessions(
    @CurrentStudent() student: AccessTokenPayload | null,
    @Query('teilNumber') teilNumber?: string,
  ): Promise<ExerciseAttemptDto[]> {
    if (!student?.studentId) return [];
    const teil =
      teilNumber !== undefined ? parseInt(teilNumber, 10) : undefined;
    return this.listeningService.getSessions(student.studentId, teil);
  }

  @Get('exercise')
  @ApiOperation({
    summary: 'Fetch a Hören exercise',
    description:
      'Returns the audio URL, image, content_revision, and the list of richtig(+)/falsch(−) ' +
      'statements for the given Teil. No options array — the student marks each statement as "+" or "−".',
  })
  @ApiQuery({
    name: 'type',
    required: true,
    description: 'Teil id',
    example: '1',
    enum: ['1', '2', '3'],
  })
  @ApiOkResponse({ type: ListeningExerciseDto })
  @ApiNotFoundResponse({ description: 'Unknown type — not "1", "2", or "3"' })
  async getExercise(
    @Query('type') type: string,
  ): Promise<ListeningExerciseDto> {
    return this.listeningService.getExercise(type);
  }

  @Post('submit')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Submit Hören answers and receive the answer key',
    description:
      'Stores the attempt and returns the correct answer key. ' +
      'The frontend compares the student\'s submitted answers against answerKey to compute per-question verdicts and the score locally. ' +
      'Score is computed server-side and stored in history but is NOT returned in this response.',
  })
  @ApiCreatedResponse({
    description: 'Answers accepted — answer key returned',
    type: SubmitListeningResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description:
      'listeningUnknownType — type is not 1/2/3 | ' +
      'listeningStaleRevision — content_revision mismatch | ' +
      'listeningEmptyAnswers — answers object is empty',
  })
  async submit(
    @CurrentStudent() student: AccessTokenPayload | null,
    @Body() dto: SubmitListeningDto,
  ): Promise<SubmitListeningResponseDto> {
    if (!student?.studentId) {
      throw new UnauthorizedException('INVALID_ACCESS_TOKEN');
    }
    return this.listeningService.submit(student.studentId, dto);
  }
}
