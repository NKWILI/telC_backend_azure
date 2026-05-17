import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  UseGuards,
  UnauthorizedException,
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
    @Query('modelltest', new DefaultValuePipe(1), ParseIntPipe) modelltest: number,
  ): Promise<SprachbausteineExerciseResponseDto> {
    return this.sprachbausteineService.getExercise(modelltest);
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
