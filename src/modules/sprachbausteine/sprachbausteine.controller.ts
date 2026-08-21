import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { CurrentStudent } from '../../shared/decorators/current-student.decorator';
import type { AccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { SprachbausteineService } from './sprachbausteine.service';
import {
  SprachbausteineExerciseResponseDto,
  SubmitSprachbausteineResponseDto,
} from './dto';
import { SubmitSprachbausteineDto } from './dto/submit-sprachbausteine.dto';
import type { ExerciseAttemptDto } from '../writing/dto/exercise-attempt.dto';
import type { ExerciseTypeDto } from '../writing/dto/exercise-type.dto';

/** Served when the caller omits ?modelltest= — keeps existing clients working. */
const DEFAULT_MODELLTEST = 1;

@UseGuards(JwtAuthGuard)
@ApiTags('Sprachbausteine')
@Controller('api/sprachbausteine')
export class SprachbausteineController {
  constructor(
    private readonly sprachbausteineService: SprachbausteineService,
  ) {}

  @Get('exercise')
  @ApiQuery({ name: 'modelltest', required: false, schema: { type: 'integer', default: 1 }, example: 1 })
  @ApiOkResponse({ type: SprachbausteineExerciseResponseDto })
  getExercise(
    // Declared as string on purpose. The global ValidationPipe in main.ts runs
    // with transform: true, so a `number` param has 'abc' coerced to NaN before
    // any parameter pipe sees it — DefaultValuePipe then substitutes 1 and the
    // caller silently receives Modelltest 1 instead of an error. Parsing the
    // raw string here keeps malformed input a 400. Same approach as
    // lesen.controller.ts and writing.controller.ts:69.
    @Query('modelltest') modelltest?: string,
  ): Promise<SprachbausteineExerciseResponseDto> {
    if (modelltest === undefined || modelltest === '') {
      return this.sprachbausteineService.getExercise(DEFAULT_MODELLTEST);
    }

    if (!/^\d+$/.test(modelltest)) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: 'modelltest query param must be a positive integer',
        messageKey: 'sprachbausteineInvalidModelltest',
      });
    }

    return this.sprachbausteineService.getExercise(Number(modelltest));
  }

  @Get('sessions')
  @ApiQuery({ name: 'teilNumber', required: false, schema: { type: 'string', enum: ['1', '2'] } })
  async getSessions(
    @CurrentStudent() student: AccessTokenPayload | null,
    @Query('teilNumber') teilNumber?: string,
  ): Promise<ExerciseAttemptDto[]> {
    if (!student?.studentId) return [];
    const teil = teilNumber !== undefined ? parseInt(teilNumber, 10) : undefined;
    return this.sprachbausteineService.getSessions(student.studentId, teil);
  }

  @Get('teils')
  async getTeils(
    @CurrentStudent() student: AccessTokenPayload | null,
  ): Promise<ExerciseTypeDto[]> {
    if (!student?.studentId) return [];
    return this.sprachbausteineService.getTeils(student.studentId);
  }

  @Post('submit')
  @ApiBody({ type: SubmitSprachbausteineDto })
  @ApiOkResponse({ type: SubmitSprachbausteineResponseDto })
  submit(
    @CurrentStudent() student: AccessTokenPayload | null,
    @Body() dto: SubmitSprachbausteineDto,
  ): Promise<SubmitSprachbausteineResponseDto> {
    if (!student?.studentId) {
      throw new UnauthorizedException('INVALID_ACCESS_TOKEN');
    }
    return this.sprachbausteineService.submit(student.studentId, dto);
  }
}
