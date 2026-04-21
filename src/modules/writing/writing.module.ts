import { Module } from '@nestjs/common';
import { WritingController } from './writing.controller';
import { WritingService } from './writing.service';
import { WritingGateway } from './writing.gateway';
import { WritingCorrectionService } from './writing-correction.service';
import { RateLimitService } from '../../shared/services/rate-limit.service';
import { AuthModule } from '../auth/auth.module';
import { SpeakingModule } from '../speaking/speaking.module';

/**
 * Writing (Schreiben) module.
 * REST: GET teils, GET sessions, POST submit.
 * WebSocket namespace /writing for correction_ready; in-process queue runs correction via Gemini (stub fallback).
 */
@Module({
  imports: [AuthModule, SpeakingModule],
  controllers: [WritingController],
  providers: [
    WritingService,
    WritingGateway,
    WritingCorrectionService,
    RateLimitService,
    {
      provide: 'WRITING_CORRECTION_QUEUE',
      useFactory: (correctionService: WritingCorrectionService) => ({
        add: (data: {
          attemptId: string;
          studentId: string;
          exerciseId: string;
          content: string;
          createdAt: string;
        }) => {
          setImmediate(() => correctionService.runCorrection(data));
          return Promise.resolve();
        },
      }),
      inject: [WritingCorrectionService],
    },
  ],
  exports: [WritingService],
})
export class WritingModule {}
