import { Injectable, Logger } from '@nestjs/common';
import type { AiOperation } from '@prisma/client';
import { PrismaService } from './prisma.service';

/**
 * Reads and writes the rows that are the quota.
 *
 * Deliberately knows nothing about allowances. It answers "how many, since
 * when" and "what was the oldest"; what those numbers mean for a given tier is
 * `AiQuotaService`'s question. Keeping them apart is what lets the allowance
 * rules be tested without a database and the row handling be tested without
 * inventing tiers.
 *
 * There is no counter and nothing resets on a schedule. The allowance is "how
 * many of these rows are newer than the cutoff", so there is no stored number
 * that can drift away from the rows it claims to describe — the same reasoning
 * that left subscription status derived from timestamps.
 */
@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records one successful chargeable operation.
   *
   * Called after the AI has returned something usable, never when the student
   * presses start. Charging on the attempt would make the student pay for our
   * outage: a Gemini failure would spend one of a Start student's two daily
   * sessions and hand them nothing, and a bad afternoon on our side would cost
   * them the day. Metered APIs do not bill a 500.
   *
   * The trade is that a student may retry a genuine failure for free, so one
   * counted session can cost us two calls to Gemini. That is the right way
   * round: the cost of our failure lands on us.
   *
   * `created_at` is left to the database. A caller able to supply it could
   * date a row into the past and refill its own allowance.
   */
  async record(studentId: string, operation: AiOperation): Promise<void> {
    await this.prisma.aiUsage.create({
      data: { student_id: studentId, operation },
    });
  }

  /**
   * Records without letting a write failure break the thing it was measuring.
   *
   * For the one caller that has already given the student their result. At
   * that point the work is done and delivered, so failing the response because
   * the meter could not be written would take away something the student has
   * earned in order to protect a number. The row is lost and the student gets
   * one free operation; the alternative is an error after a success, which is
   * worse for them and no better for us.
   *
   * Logged at error level, because a quota that silently stops counting is
   * exactly the kind of fault nobody notices until the bill arrives.
   */
  async recordDelivered(
    studentId: string,
    operation: AiOperation,
  ): Promise<void> {
    try {
      await this.record(studentId, operation);
    } catch (error) {
      this.logger.error(
        `Failed to record ${operation} for student ${studentId}; the quota will undercount by one`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** How many of this student's operations are newer than `since`. */
  async countSince(
    studentId: string,
    operation: AiOperation,
    since: Date,
  ): Promise<number> {
    return this.prisma.aiUsage.count({
      where: {
        student_id: studentId,
        operation,
        created_at: { gte: since },
      },
    });
  }

  /**
   * When this student's oldest counted operation happened, or null if none is
   * in the window.
   *
   * This is what a reset time is computed from: the moment that row falls out
   * of the window is its timestamp plus the window length. A fixed midnight
   * would be wrong for everyone outside one timezone, and a rolling window has
   * no midnight to pick.
   */
  async oldestSince(
    studentId: string,
    operation: AiOperation,
    since: Date,
  ): Promise<Date | null> {
    const row = await this.prisma.aiUsage.findFirst({
      where: {
        student_id: studentId,
        operation,
        created_at: { gte: since },
      },
      orderBy: { created_at: 'asc' },
      select: { created_at: true },
    });

    return row?.created_at ?? null;
  }
}
