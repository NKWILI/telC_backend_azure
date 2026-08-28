import { Injectable, Logger } from '@nestjs/common';
import { SpeakingLevel } from './speaking-topics.data';
import { SafetyService } from './safety.service';

export interface LobbyEntry {
  socketId: string;
  displayName: string;
  level: SpeakingLevel;
  joinedAt: Date;
}

/**
 * The pair a match produced. `host` waited longer, which is the only thing that
 * distinguishes the two — the host is simply whoever queued first.
 */
export interface LobbyMatch {
  host: LobbyEntry;
  guest: LobbyEntry;
}

export type EnqueueResult = 'queued' | 'already-searching' | 'queue-full';

/**
 * The waiting room in front of the waiting room.
 *
 * Holds sockets that have asked for a partner but do not yet have one, and pairs
 * them off. Deliberately knows nothing about rooms, WebRTC or sockets: a match
 * produces two entries, and the gateway turns those into a room using the
 * existing RoomService. That keeps every signalling path already shipped
 * untouched by this feature.
 *
 * In-memory and single-instance, exactly like RoomService. Two students on
 * different instances would never see each other, the same constraint the rooms
 * already carry — see SPRECHEN_ROOM_REFERENCE.md.
 */
@Injectable()
export class LobbyService {
  private readonly logger = new Logger(LobbyService.name);
  private readonly waiting = new Map<string, LobbyEntry>();

  private readonly entryTtlMs: number;
  private readonly maxSize: number;

  constructor(private readonly safetyService: SafetyService) {
    this.entryTtlMs =
      parseInt(process.env.LOBBY_ENTRY_TTL_SECONDS || '120', 10) * 1000;
    this.maxSize = parseInt(process.env.LOBBY_MAX_SIZE || '200', 10);
  }

  /**
   * Adds a socket to the queue. Does not match — call {@link findMatch} next.
   *
   * Returns a result rather than throwing because each outcome is a different
   * event to the client, and none of them is exceptional.
   */
  enqueue(
    socketId: string,
    displayName: string,
    level: SpeakingLevel,
  ): EnqueueResult {
    this.prune();

    if (this.waiting.has(socketId)) return 'already-searching';
    if (this.waiting.size >= this.maxSize) return 'queue-full';

    this.waiting.set(socketId, {
      socketId,
      displayName,
      level,
      joinedAt: new Date(),
    });

    this.logger.log(
      JSON.stringify({
        event: 'lobby.queued',
        level,
        waiting: this.waiting.size,
      }),
    );

    return 'queued';
  }

  /**
   * Pairs `socketId` with the longest-waiting compatible partner and removes
   * BOTH from the queue.
   *
   * Removing at match time rather than when the room is joined is deliberate: a
   * client that is slow to act on `partner-found` would otherwise still be
   * sitting in the queue and could be handed a second partner, leaving one
   * person waiting in a room nobody is coming to.
   *
   * Returns null when nobody else is waiting, which is the normal case at demo
   * scale and not an error.
   */
  findMatch(socketId: string): LobbyMatch | null {
    this.prune();

    const seeker = this.waiting.get(socketId);
    if (!seeker) return null;

    const partner = this.longestWaitingPartner(seeker);
    if (!partner) return null;

    this.waiting.delete(seeker.socketId);
    this.waiting.delete(partner.socketId);

    // Whoever queued first hosts. Nothing else separates them, and using wait
    // time means the person who has been staring at a spinner longest is the
    // one whose client drives the offer.
    const [host, guest] =
      partner.joinedAt <= seeker.joinedAt ? [partner, seeker] : [seeker, partner];

    this.logger.log(
      JSON.stringify({
        event: 'lobby.matched',
        level: host.level,
        waitedMs: Date.now() - host.joinedAt.getTime(),
        waiting: this.waiting.size,
      }),
    );

    return { host, guest };
  }

  /** Removes a socket from the queue. Idempotent; safe on an unknown socket. */
  dequeue(socketId: string): boolean {
    const removed = this.waiting.delete(socketId);

    if (removed) {
      this.logger.log(
        JSON.stringify({ event: 'lobby.left', waiting: this.waiting.size }),
      );
    }

    return removed;
  }

  /**
   * How many people the given socket could actually be matched with.
   *
   * Two things make this number honest rather than merely large. It excludes
   * the asker, because telling the only person queued that one person is
   * waiting promises a match that cannot happen. And it counts only their own
   * level, because someone waiting at a different level is not a candidate —
   * that is inert today, since B1 is the only level, and would otherwise
   * silently become wrong the moment a second level is seeded.
   *
   * Expect this to read 0 almost always: pairing happens on arrival, so the
   * queue holds at most one person per level. It is a truthful number, not a
   * measure of how busy the lobby is.
   */
  countWaiting(excludeSocketId?: string): number {
    this.prune();

    const asker = excludeSocketId
      ? this.waiting.get(excludeSocketId)
      : undefined;

    let count = 0;
    for (const entry of this.waiting.values()) {
      if (entry.socketId === excludeSocketId) continue;
      if (asker && entry.level !== asker.level) continue;
      count += 1;
    }

    return count;
  }

  isWaiting(socketId: string): boolean {
    this.prune();
    return this.waiting.has(socketId);
  }

  /** Every socket still queued, for broadcasting a changed count. */
  waitingSocketIds(): string[] {
    this.prune();
    return [...this.waiting.keys()];
  }

  private longestWaitingPartner(seeker: LobbyEntry): LobbyEntry | undefined {
    let best: LobbyEntry | undefined;

    for (const candidate of this.waiting.values()) {
      if (candidate.socketId === seeker.socketId) continue;
      if (candidate.level !== seeker.level) continue;
      // Someone the seeker reported, or who reported them, is skipped rather
      // than refused: neither side is told a block exists, so a report cannot
      // be used to probe whether a particular person is online.
      if (this.safetyService.isBlocked(seeker.socketId, candidate.socketId)) {
        continue;
      }
      if (!best || candidate.joinedAt < best.joinedAt) best = candidate;
    }

    return best;
  }

  /**
   * Drops entries older than the TTL.
   *
   * A socket can disappear without a clean disconnect — a closed laptop, a lost
   * mobile connection — and an entry left behind would be matched with someone
   * who then waits in a room nobody joins. Sweeping on read means no timer and
   * no background job, and the queue heals itself.
   */
  private prune(): void {
    const cutoff = Date.now() - this.entryTtlMs;

    for (const [socketId, entry] of this.waiting) {
      if (entry.joinedAt.getTime() < cutoff) {
        this.waiting.delete(socketId);
        this.logger.log(JSON.stringify({ event: 'lobby.expired', socketId }));
      }
    }
  }
}
