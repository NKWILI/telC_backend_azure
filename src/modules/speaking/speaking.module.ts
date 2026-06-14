import { Module } from '@nestjs/common';
import { SpeakingController } from './speaking.controller';
import { SpeakingCatalogController } from './speaking-catalog.controller';
import { SpeakingService } from './services/speaking.service';
import { GeminiService } from './services/gemini.service';
import { EvaluationService } from './services/evaluation.service';
import { AuthModule } from '../auth/auth.module';
import { RoomModule } from './room/room.module';

@Module({
  imports: [AuthModule, RoomModule],
  controllers: [SpeakingController, SpeakingCatalogController],
  providers: [SpeakingService, GeminiService, EvaluationService],
  exports: [SpeakingService, GeminiService, EvaluationService],
})
export class SpeakingModule {}
