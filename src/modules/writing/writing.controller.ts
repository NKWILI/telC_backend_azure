import {
  Controller,
  Get,
  Post,
  Body,
  Query,
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
import type { ExerciseTypeDto, ExerciseAttemptDto } from './dto';
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

  @Get('teils')
  async getTeils(
    @CurrentStudent() student: AccessTokenPayload | null,
  ): Promise<ExerciseTypeDto[]> {
    const studentId = student?.studentId;
    if (!studentId) return [];
    return this.writingService.getTeils(studentId);
  }

  @Get('sessions')
  async getSessions(
    @CurrentStudent() student: AccessTokenPayload | null,
    @Query('teilNumber') teilNumber?: string,
  ): Promise<ExerciseAttemptDto[]> {
    const studentId = student?.studentId;
    if (!studentId) return [];
    const teil = teilNumber ? parseInt(teilNumber, 10) : undefined;
    return this.writingService.getSessions(studentId, teil);
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
