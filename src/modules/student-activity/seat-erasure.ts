import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/services/prisma.service';

/** How long hidden data waits before it is erased: support's window (D39). */
export const ERASE_AFTER_DAYS = 7;
const DAY_MS = 86_400_000;
/** How often the erasing job looks for due erasures. */
const PURGE_EVERY_MS = 6 * 60 * 60 * 1000;

export interface SeatErasureInput {
  studentId: string;
  centerId: string;
  codeId: string;
  centerUserId: string | null;
  /** The student's time on the seat: only what was done inside it goes. */
  since: Date;
  until: Date;
}

/**
 * Hides a student's learning data on a seat, when a reset takes the seat from
 * them (D39). Runs inside the reset's transaction: the seat and the data move
 * together or not at all.
 *
 * Hidden means stamped with the erasure's id; every history and progress read
 * skips stamped rows. The rows themselves stay for `ERASE_AFTER_DAYS`, so
 * support can restore a reset made by mistake, then `SeatErasureService`
 * deletes them.
 *
 * Only the window of the seat is touched: work from before the student joined
 * this school, or at another school afterwards, is theirs and stays.
 */
export async function hideSeatData(
  tx: Prisma.TransactionClient,
  input: SeatErasureInput,
  now = new Date(),
): Promise<string> {
  const erasure = await tx.dataErasure.create({
    data: {
      student_id: input.studentId,
      center_id: input.centerId,
      code_id: input.codeId,
      center_user_id: input.centerUserId,
      since: input.since,
      until: input.until,
      erase_after: new Date(now.getTime() + ERASE_AFTER_DAYS * DAY_MS),
    },
  });

  const window = {
    student_id: input.studentId,
    erasure_id: null,
    created_at: { gte: input.since, lte: input.until },
  };
  const stamp = { data: { erasure_id: erasure.id } };
  await tx.listeningAttempt.updateMany({ where: window, ...stamp });
  await tx.sprachbausteineAttempt.updateMany({ where: window, ...stamp });
  await tx.writingAttempt.updateMany({ where: window, ...stamp });
  await tx.lesenAttempt.updateMany({ where: window, ...stamp });
  await tx.speakingAttempt.updateMany({ where: window, ...stamp });

  // The summaries follow their attempts, not the clock: a writing attempt
  // submitted on the seat may have been corrected, and summarised, a moment
  // after the reset.
  await tx.$executeRaw`
    UPDATE student_activities SET erasure_id = ${erasure.id}
    WHERE student_id = ${input.studentId}
      AND erasure_id IS NULL
      AND (
        (skill = 'HOEREN' AND attempt_id IN (SELECT attempt_id FROM listening_attempts WHERE erasure_id = ${erasure.id}))
        OR (skill = 'SPRACHBAUSTEINE' AND attempt_id IN (SELECT attempt_id FROM sprachbausteine_attempts WHERE erasure_id = ${erasure.id}))
        OR (skill = 'SCHREIBEN' AND attempt_id IN (SELECT attempt_id FROM writing_attempts WHERE erasure_id = ${erasure.id}))
        OR (skill = 'LESEN' AND attempt_id IN (SELECT attempt_id FROM lesen_attempts WHERE erasure_id = ${erasure.id}))
        OR (skill = 'SPRECHEN' AND attempt_id IN (SELECT attempt_id FROM speaking_attempts WHERE erasure_id = ${erasure.id}))
      )`;

  return erasure.id;
}

/**
 * Erases hidden seat data once its window has passed, and restores it for
 * support before then.
 */
@Injectable()
export class SeatErasureService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(SeatErasureService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * A plain interval rather than a scheduler dependency: the job is one
   * idempotent query, so two instances running it at once only do the same
   * deletes twice. Off under test, where the suites call `purgeDue` directly.
   */
  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    const run = () =>
      void this.purgeDue().catch((err: Error) =>
        this.logger.error(`Seat erasure failed: ${err.message}`),
      );
    run();
    this.timer = setInterval(run, PURGE_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Permanently deletes every erasure whose window has passed. */
  async purgeDue(now = new Date()): Promise<number> {
    const due = await this.prisma.dataErasure.findMany({
      where: { erase_after: { lte: now }, erased_at: null, restored_at: null },
      select: { id: true },
    });
    for (const { id } of due) {
      await this.prisma.$transaction(async (tx) => {
        const hidden = { where: { erasure_id: id } };
        await tx.studentActivity.deleteMany(hidden);
        await tx.listeningAttempt.deleteMany(hidden);
        await tx.sprachbausteineAttempt.deleteMany(hidden);
        await tx.writingAttempt.deleteMany(hidden);
        await tx.lesenAttempt.deleteMany(hidden);
        await tx.speakingAttempt.deleteMany(hidden);
        await tx.dataErasure.update({
          where: { id },
          data: { erased_at: now },
        });
      });
    }
    if (due.length > 0) {
      this.logger.log(`Erased the seat data of ${due.length} reset(s)`);
    }
    return due.length;
  }

  /**
   * Support only, for a reset made by mistake: shows the data again. It does
   * not give the seat back — that is a new code for the student.
   */
  async restore(erasureId: string, now = new Date()): Promise<void> {
    const erasure = await this.prisma.dataErasure.findUnique({
      where: { id: erasureId },
    });
    if (!erasure) throw new NotFoundException('ERASURE_NOT_FOUND');
    if (erasure.erased_at) throw new ConflictException('ALREADY_ERASED');
    if (erasure.restored_at) return;

    await this.prisma.$transaction(async (tx) => {
      const hidden = { where: { erasure_id: erasureId } };
      const shown = { data: { erasure_id: null } };
      await tx.studentActivity.updateMany({ ...hidden, ...shown });
      await tx.listeningAttempt.updateMany({ ...hidden, ...shown });
      await tx.sprachbausteineAttempt.updateMany({ ...hidden, ...shown });
      await tx.writingAttempt.updateMany({ ...hidden, ...shown });
      await tx.lesenAttempt.updateMany({ ...hidden, ...shown });
      await tx.speakingAttempt.updateMany({ ...hidden, ...shown });
      await tx.dataErasure.update({
        where: { id: erasureId },
        data: { restored_at: now },
      });
    });
  }
}
