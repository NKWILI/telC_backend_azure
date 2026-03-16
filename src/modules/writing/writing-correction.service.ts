import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../shared/services/database.service';
import {
  WritingGateway,
  CorrectionReadyPayload,
} from './writing.gateway';

export interface CorrectionJobData {
  attemptId: string;
  studentId: string;
  exerciseId: string;
  content: string;
  createdAt: string;
}

const STUB_SCORE = 75;
const STUB_FEEDBACK = 'Stub feedback. Echte Korrektur folgt.';

@Injectable()
export class WritingCorrectionService {
  private readonly logger = new Logger(WritingCorrectionService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly gateway: WritingGateway,
  ) {}

  /**
   * Run correction (stub), update writing_attempts, emit correction_ready.
   * Does not throw; logs errors so the in-process job does not crash the app.
   */
  async runCorrection(data: CorrectionJobData): Promise<void> {
    const { attemptId, studentId, exerciseId, createdAt } = data;
    try {
      const completedAt = new Date().toISOString();
      const created = new Date(createdAt).getTime();
      const durationSeconds = Math.round(
        (Date.now() - created) / 1000,
      );

      const { error: updateError } = await this.db
        .getClient()
        .from('writing_attempts')
        .update({
          status: 'completed',
          score: STUB_SCORE,
          feedback: STUB_FEEDBACK,
          duration_seconds: durationSeconds,
          completed_at: completedAt,
        })
        .eq('attempt_id', attemptId);

      if (updateError) {
        this.logger.error(
          `Failed to update writing attempt ${attemptId}: ${updateError.message}`,
        );
        return;
      }

      const payload: CorrectionReadyPayload = {
        attemptId,
        exerciseId,
        status: 'completed',
        score: STUB_SCORE,
        feedback: STUB_FEEDBACK,
        durationSeconds,
        corrections: [],
      };

      this.gateway.notifyCorrectionReady(studentId, payload);
    } catch (err) {
      this.logger.error(
        `Correction failed for attempt ${attemptId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
