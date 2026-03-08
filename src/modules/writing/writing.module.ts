import { Module } from '@nestjs/common';
import { WritingController } from './writing.controller';
import { WritingService } from './writing.service';
import { WritingGateway } from './writing.gateway';
import { DatabaseService } from '../../shared/services/database.service';
import { RateLimitService } from '../../shared/services/rate-limit.service';
import { AuthModule } from '../auth/auth.module';

/**
 * Writing (Schreiben) module.
 * REST: GET teils, GET sessions, POST submit.
 * WebSocket namespace /writing for correction_ready (optional queue + worker).
 */
@Module({
  imports: [AuthModule],
  controllers: [WritingController],
  providers: [
    WritingService,
    WritingGateway,
    DatabaseService,
    RateLimitService,
  ],
  exports: [WritingService],
})
export class WritingModule {}
