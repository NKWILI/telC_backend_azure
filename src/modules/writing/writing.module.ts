import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pLimit from 'p-limit';
import { parsePositiveInt } from '../../shared/utils/parse-positive-int';
import { WritingController } from './writing.controller';
import { WritingService } from './writing.service';
import { WritingGateway } from './writing.gateway';
import { WritingCorrectionService } from './writing-correction.service';
import { GrokService } from './services/grok.service';
import { MODEL_SERVICE_TOKEN } from './services/model-service.interface';
import { RateLimitService } from '../../shared/services/rate-limit.service';
import { AuthModule } from '../auth/auth.module';
import { SpeakingModule } from '../speaking/speaking.module';
import { GeminiService } from '../speaking/services/gemini.service';

/**
 * Writing (Schreiben) module.
 * REST: GET teils, GET sessions, POST submit.
 * WebSocket namespace /writing for correction_ready; in-process queue runs correction via the configured ModelService (stub fallback).
 * Provider is selected by MODEL_PROVIDER env var: 'grok' uses GrokService, anything else (incl. unset) uses GeminiService.
 */
@Module({
  imports: [AuthModule, SpeakingModule],
  controllers: [WritingController],
  providers: [
    WritingService,
    WritingGateway,
    WritingCorrectionService,
    RateLimitService,
    GrokService,
    {
      provide: MODEL_SERVICE_TOKEN,
      useFactory: (
        config: ConfigService,
        gemini: GeminiService,
        grok: GrokService,
      ) => {
        const provider = config.get<string>('MODEL_PROVIDER') ?? 'gemini';
        const selected = provider === 'grok' ? grok : gemini;
        new Logger('WritingModule').log(
          `Using ${provider === 'grok' ? 'grok' : 'gemini'} model for correction`,
        );
        return selected;
      },
      inject: [ConfigService, GeminiService, GrokService],
    },
    {
      provide: 'WRITING_CORRECTION_QUEUE',
      useFactory: (correctionService: WritingCorrectionService) => {
        const concurrency = parsePositiveInt(
          process.env.WRITING_CORRECTION_CONCURRENCY,
          5,
        );
        const limit = pLimit(concurrency);
        new Logger('WritingModule').log(
          `Correction worker concurrency capped at ${concurrency}`,
        );
        return {
          add: (data: {
            attemptId: string;
            studentId: string;
            exerciseId: string;
            content: string;
            createdAt: string;
          }) => {
            // p-limit schedules asynchronously and returns immediately, so the
            // heavy correction never blocks the HTTP response. Fire-and-forget:
            // runCorrection swallows its own errors, so the floating promise is
            // intentional.
            void limit(() => correctionService.runCorrection(data));
            return Promise.resolve();
          },
        };
      },
      inject: [WritingCorrectionService],
    },
  ],
  exports: [WritingService],
})
export class WritingModule {}
