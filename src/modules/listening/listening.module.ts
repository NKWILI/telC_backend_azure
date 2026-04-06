import { Module } from '@nestjs/common';
import { ListeningController } from './listening.controller';
import { ListeningService } from './listening.service';
import { DatabaseService } from '../../shared/services/database.service';
import { AuthModule } from '../auth/auth.module';

/**
 * Listening (Hören) module.
 * REST: GET teils, GET sessions, GET exercise, POST submit.
 * Auto-scoring against a hardcoded catalog — no LLM, no WebSocket.
 */
@Module({
  imports: [AuthModule],
  controllers: [ListeningController],
  providers: [ListeningService, DatabaseService],
})
export class ListeningModule {}
