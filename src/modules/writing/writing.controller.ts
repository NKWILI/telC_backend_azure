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
} from '@nestjs/common';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { CurrentStudent } from '../../shared/decorators/current-student.decorator';
import { AccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { WritingService } from './writing.service';
import { RateLimitService } from '../../shared/services/rate-limit.service';
import type {
  ExerciseAttemptDto,
  WritingExerciseDto,
} from './dto';
import { SubmitWritingDto } from './dto/submit-writing.dto';
import { SubmitWritingResponseDto } from './dto/submit-writing-response.dto';

/**
 * Writing (Schreiben) module REST API.
 * GET /api/writing/teils, GET /api/writing/sessions, POST /api/writing/submit.
 */
@UseGuards(JwtAuthGuard)
@Controller('api/writing')
export class WritingController {
  constructor(
    private readonly writingService: WritingService,
    private readonly rateLimitService: RateLimitService,
  ) {}

  @Get('exercise/:id')
  async getExercise(
    @Param('id') id: string,
  ): Promise<WritingExerciseDto> {
    return this.writingService.getExercise(id);
  }

  @Get('sessions')
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
  async submit(
    @CurrentStudent() student: AccessTokenPayload | null,
    @Body() dto: SubmitWritingDto,
  ): Promise<SubmitWritingResponseDto> {
    const studentId = student?.studentId;
    if (!studentId) {
      throw new UnauthorizedException('INVALID_ACCESS_TOKEN');
    }
    this.rateLimitService.checkWritingSubmitLimit(studentId);
    return this.writingService.submit(studentId, dto);
  }
}
