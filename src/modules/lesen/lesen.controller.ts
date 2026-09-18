import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';

/** Served when the caller omits ?modelltest= — keeps existing clients working. */
const DEFAULT_MODELLTEST = 1;
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { StudentSubscriptionGuard } from '../../shared/guards/student-subscription.guard';
import { CurrentStudent } from '../../shared/decorators/current-student.decorator';
import type { AccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { LesenService } from './lesen.service';
import { LesenExerciseResponseDto, LesenSubmitResponseDto } from './dto';
import { LesenSubmitRequestDto } from './dto/lesen-submit-request.dto';
import { ExerciseAttemptDto } from '../writing/dto/exercise-attempt.dto';
import type { ExerciseTypeDto } from '../writing/dto/exercise-type.dto';

@ApiTags('Reading')
@UseGuards(JwtAuthGuard, StudentSubscriptionGuard)
@Controller('api/reading')
export class LesenController {
  constructor(private readonly lesenService: LesenService) {}

  @Get('exercise')
  @ApiQuery({
    name: 'modelltest',
    required: false,
    schema: { type: 'integer', default: 1 },
    example: 1,
    description:
      'Which Modelltest to serve. Defaults to 1 when omitted. All three Teils come from the same Modelltest.',
  })
  @ApiOkResponse({ type: LesenExerciseResponseDto })
  getExercise(
    // Declared as string on purpose. The global ValidationPipe in main.ts runs
    // with transform: true, so a `number` param would have 'abc' coerced to NaN
    // before any param pipe sees it — DefaultValuePipe then silently substitutes
    // 1 and the caller gets Modelltest 1 instead of an error. Parsing the raw
    // string here keeps malformed input a 400. Same approach as
    // writing.controller.ts:69.
    @Query('modelltest') modelltest?: string,
  ): Promise<LesenExerciseResponseDto> {
    if (modelltest === undefined || modelltest === '') {
      return this.lesenService.getExercise(DEFAULT_MODELLTEST);
    }

    if (!/^\d+$/.test(modelltest)) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: 'modelltest query param must be a positive integer',
        messageKey: 'readingInvalidModelltest',
      });
    }

    return this.lesenService.getExercise(Number(modelltest));
  }

  @Get('sessions')
  @ApiQuery({
    name: 'teilNumber',
    required: false,
    schema: { type: 'string', enum: ['1', '2', '3'] },
  })
  @ApiOkResponse({ type: [ExerciseAttemptDto] })
  getSessions(
    @CurrentStudent() student: AccessTokenPayload | null,
    @Query('teilNumber') teilNumber?: string,
  ): Promise<ExerciseAttemptDto[]> {
    if (!student?.studentId || student.isGuest) return Promise.resolve([]);
    const teil =
      teilNumber !== undefined ? parseInt(teilNumber, 10) : undefined;
    return this.lesenService.getSessions(student.studentId, teil);
  }

  @Get('teils')
  getTeils(
    @CurrentStudent() student: AccessTokenPayload | null,
  ): Promise<ExerciseTypeDto[]> {
    if (!student?.studentId) return Promise.resolve([]);
    return this.lesenService.getTeils(student.studentId);
  }

  @Post('submit')
  @ApiBody({ type: LesenSubmitRequestDto })
  @ApiOkResponse({ type: LesenSubmitResponseDto })
  submit(
    @CurrentStudent() student: AccessTokenPayload | null,
    @Body() dto: LesenSubmitRequestDto,
  ): Promise<LesenSubmitResponseDto> {
    if (!student?.studentId) {
      throw new UnauthorizedException('INVALID_ACCESS_TOKEN');
    }
    return this.lesenService.submit(student, dto);
  }
}
