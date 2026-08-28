import { Injectable, Logger } from '@nestjs/common';

export interface PartnerReport {
  roomId: string;
  reporterSocketId: string;
  reportedSocketId: string | null;
  reason?: string;
}

/**
 * Reports and blocks for the lobby.
 *
 * There is no moderator tooling and no database table behind this. The record
 * IS the log line: structured, greppable by roomId, and enough to reconstruct
 * what was reported and when. That is a deliberate first step rather than a
 * finished trust-and-safety system — the alternative was shipping strangers on
 * live video with no record at all.
 *
 * Blocks are keyed by socket id, which means they last for the session and no
 * longer. An anonymous demo has no stable identity to hang anything durable on:
 * a reported user who reconnects gets a new socket id and is matchable again.
 * Durable blocking needs accounts. Stated plainly here so nobody reads more
 * protection into this than it provides.
 */
@Injectable()
export class SafetyService {
  private readonly logger = new Logger(SafetyService.name);
  /** pair key → expiry epoch ms */
  private readonly blocked = new Map<string, number>();
  private readonly blockTtlMs: number;

  constructor() {
    this.blockTtlMs =
      parseInt(process.env.LOBBY_BLOCK_TTL_MINUTES || '720', 10) * 60_000;
  }

  /**
   * Records a report and blocks the pair from being matched again.
   *
   * Logged at warn so it stands out in a log stream that is otherwise all
   * lifecycle noise. The reason is truncated by the DTO before it reaches here.
   */
  report(report: PartnerReport): void {
    this.logger.warn(
      JSON.stringify({
        event: 'lobby.reported',
        roomId: report.roomId,
        reporter: report.reporterSocketId,
        reported: report.reportedSocketId,
        reason: report.reason ?? null,
        at: new Date().toISOString(),
      }),
    );

    if (report.reportedSocketId) {
      this.block(report.reporterSocketId, report.reportedSocketId);
    }
  }

  block(a: string, b: string): void {
    this.blocked.set(this.pairKey(a, b), Date.now() + this.blockTtlMs);
  }

  isBlocked(a: string, b: string): boolean {
    const key = this.pairKey(a, b);
    const expiresAt = this.blocked.get(key);

    if (expiresAt === undefined) return false;

    if (expiresAt <= Date.now()) {
      this.blocked.delete(key);
      return false;
    }

    return true;
  }

  /** Order-independent, so a block applies in both directions. */
  private pairKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }
}
