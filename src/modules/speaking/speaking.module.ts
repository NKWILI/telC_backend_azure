import { Module } from '@nestjs/common';
import { SpeakingController } from './speaking.controller';
import { SpeakingCatalogController } from './speaking-catalog.controller';
import { SpeakingService } from './services/speaking.service';
import { GeminiService } from './services/gemini.service';
import { EvaluationService } from './services/evaluation.service';
import { SpeakingGateway } from './speaking.gateway';
import { DatabaseService } from '../../shared/services/database.service';
import { AuthModule } from '../auth/auth.module';

/**
 * Speaking Module (SPRECHEN)
 * Handles real-time speaking exams with Gemini Live API
 *
 * Features:
 * - REST endpoints for session management (start, pause, resume, end)
 * - GET teils and GET sessions for frontend catalog/history
 * - WebSocket gateway for real-time audio streaming
 * - Evaluation service for automatic assessment
 */
@Module({
  imports: [AuthModule], // Import AuthModule for TokenService (required by JwtAuthGuard)
  controllers: [SpeakingController, SpeakingCatalogController],
  providers: [
    SpeakingService,
    GeminiService,
    EvaluationService,
    DatabaseService,
    SpeakingGateway,
  ],
  exports: [SpeakingService, GeminiService, EvaluationService],
})
export class SpeakingModule {}
