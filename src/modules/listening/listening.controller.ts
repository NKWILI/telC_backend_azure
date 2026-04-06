import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { CurrentStudent } from '../../shared/decorators/current-student.decorator';
import { AccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { ListeningService } from './listening.service';
import type { ExerciseTypeDto } from '../writing/dto/exercise-type.dto';
import type { ExerciseAttemptDto } from '../writing/dto/exercise-attempt.dto';
import type { ListeningExerciseDto } from './dto/listening-exercise.dto';
import { SubmitListeningDto } from './dto/submit-listening.dto';
import type { SubmitListeningResponseDto } from './dto/submit-listening-response.dto';

/**
 * Listening (Hören) module REST API.
 * GET /api/listening/teils
 * GET /api/listening/sessions
 * GET /api/listening/exercise
 * POST /api/listening/submit
 */
@UseGuards(JwtAuthGuard)
@Controller('api/listening')
export class ListeningController {
  constructor(private readonly listeningService: ListeningService) {}

  @Get('teils')
  async getTeils(
    @CurrentStudent() student: AccessTokenPayload | null,
  ): Promise<ExerciseTypeDto[]> {
    if (!student?.studentId) return [];
    return this.listeningService.getTeils(student.studentId);
  }

  @Get('sessions')
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
  async getExercise(
    @Query('type') type: string,
  ): Promise<ListeningExerciseDto> {
    return this.listeningService.getExercise(type);
  }

  @Post('submit')
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
