import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { AccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { SpeakingService } from './services/speaking.service';
import type { TeilListItemDto, SessionHistoryItemDto } from './dto';

/**
 * Catalog endpoints for Sprechen: list of Teils and session history.
 * GET /api/speaking/teils, GET /api/speaking/sessions
 */
@UseGuards(JwtAuthGuard)
@Controller('api/speaking')
export class SpeakingCatalogController {
  constructor(private readonly speakingService: SpeakingService) {}

  /**
   * GET /api/speaking/teils
   * Returns the list of 3 Teils (metadata for list/detail screens).
   */
  @Get('teils')
  getTeils(): TeilListItemDto[] {
    return this.speakingService.getTeils();
  }

  /**
   * GET /api/speaking/sessions
   * Returns session history for the authenticated student.
   * Query: teilNumber (1|2|3), limit (default 50).
   */
  @Get('sessions')
  async getSessions(
    @Request() req: { student: AccessTokenPayload },
    @Query('teilNumber') teilNumber?: string,
    @Query('limit') limitStr?: string,
  ): Promise<SessionHistoryItemDto[]> {
    const studentId = req.student?.studentId;
    if (!studentId) {
      return [];
    }
    const teil = teilNumber ? parseInt(teilNumber, 10) : undefined;
    const limit = limitStr ? parseInt(limitStr, 10) : 50;
    return this.speakingService.getSessions(studentId, teil, limit);
  }
}
