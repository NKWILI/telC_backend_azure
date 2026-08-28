import { Injectable, Logger } from '@nestjs/common';
import { SpeakingLevel } from './speaking-topics.data';

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

  constructor() {
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
   * How many people are waiting, excluding the asker.
   *
   * Excluding yourself is what makes the number honest: a lone student would
   * otherwise be told "1 person waiting" and reasonably expect a match.
   */
  countWaiting(excludeSocketId?: string): number {
    this.prune();

    if (excludeSocketId && this.waiting.has(excludeSocketId)) {
      return this.waiting.size - 1;
    }

    return this.waiting.size;
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
