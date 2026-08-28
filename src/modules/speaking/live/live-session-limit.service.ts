import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import NodeCache from 'node-cache';
import { ValkeyService } from '../../../shared/services/valkey.service';

const CONCURRENT_KEY = 'elena:active';

export interface LiveSessionCaller {
  /** Client IP. The only stable identity a guest has — see {@link LiveSessionLimitService.identityKey}. */
  ip: string;
  /** Present for registered students; guests get a throwaway UUID we ignore. */
  studentId?: string;
  isGuest: boolean;
}

/**
 * The spend ceiling for Elena.
 *
 * Three layers live here; two more (`uses: 1` and `expireTime`) are carried on
 * the minted token itself and enforced by Google, which is why they cannot be
 * bypassed by a modified client. These three exist so we refuse traffic before
 * Google does — a student should see our message, not a raw provider error.
 *
 * Every layer degrades to an in-process counter when Valkey is unavailable, the
 * same way {@link ValkeyService} treats rate limits: a cache outage must not
 * take Sprechen down with it.
 */
@Injectable()
export class LiveSessionLimitService {
  private readonly logger = new Logger(LiveSessionLimitService.name);
  private readonly cache = new NodeCache();
  /** member → expiry epoch ms. Fallback for the concurrency pool only. */
  private readonly localSlots = new Map<string, number>();

  private readonly ipMax: number;
  private readonly ipWindowSeconds: number;
  private readonly globalMax: number;
  private readonly concurrentMax: number;
  private readonly sessionMaxSeconds: number;

  constructor(@Optional() private readonly valkey?: ValkeyService) {
    this.ipMax = parseInt(process.env.ELENA_IP_DAILY_MAX || '2', 10);
    this.ipWindowSeconds =
      parseInt(process.env.ELENA_IP_WINDOW_MINUTES || '1440', 10) * 60;
    this.globalMax = parseInt(process.env.ELENA_GLOBAL_DAILY_MAX || '50', 10);
    this.concurrentMax = parseInt(process.env.ELENA_CONCURRENT_MAX || '2', 10);
    this.sessionMaxSeconds =
      parseInt(process.env.GEMINI_LIVE_SESSION_MAX_MINUTES || '10', 10) * 60;
  }

  get sessionSeconds(): number {
    return this.sessionMaxSeconds;
  }

  /**
   * Consumes one session's worth of every quota, or throws 429.
   *
   * Order is load-bearing, and the reason is a denial of service rather than
   * tidiness. Consuming the shared global counter before checking the caller's
   * own cap lets one exhausted IP keep spending everyone else's quota: it is
   * refused every time, yet each refusal still increments the global bucket, so
   * roughly ELENA_GLOBAL_DAILY_MAX requests take Elena down for all users. The
   * counter cannot be refunded — `enforce` only increments — so the caller's own
   * cap has to be the first thing that can reject.
   *
   * The pool is therefore only *read* up front: a full pool refuses without
   * touching anything shared. The slot is claimed last, through the atomic
   * admission call, so two simultaneous requests cannot both take the last one.
   */
  async acquire(caller: LiveSessionCaller, sessionId: string): Promise<void> {
    if (await this.poolIsFull()) {
      throw this.refuse(
        'elenaBusyNow',
        'Elena parle avec quelqu’un d’autre. Réessayez dans quelques minutes.',
      );
    }

    const identity = this.identityKey(caller);
    if (!(await this.consume(identity, this.ipMax, this.ipWindowSeconds))) {
      throw this.refuse(
        'elenaDailyLimit',
        `Vous avez utilisé vos ${this.ipMax} sessions avec Elena aujourd’hui.`,
      );
    }

    if (!(await this.consume(this.globalKey(), this.globalMax, 86_400))) {
      throw this.refuse(
        'elenaBusyToday',
        'Elena est très demandée aujourd’hui. Réessayez demain.',
      );
    }

    // Lost the race against another request for the last slot. Rare, and the
    // caller keeps the quota they just spent — the alternative is letting both
    // through and hitting the provider's own concurrency error instead.
    if (!(await this.takeConcurrentSlot(sessionId))) {
      throw this.refuse(
        'elenaBusyNow',
        'Elena parle avec quelqu’un d’autre. Réessayez dans quelques minutes.',
      );
    }

    this.logger.log(
      JSON.stringify({ event: 'elena.session.granted', sessionId }),
    );
  }

  /**
   * A guest `studentId` is a fresh `crypto.randomUUID()` minted per guest token
   * with no database row, so capping per student would be defeated by calling
   * POST /api/auth/guest again. Guests are capped by IP, which is the only
   * identity they cannot re-roll. Registered students keep a per-account cap so
   * that sharing an office NAT does not lock a class out.
   */
  private identityKey(caller: LiveSessionCaller): string {
    return caller.isGuest || !caller.studentId
      ? `ratelimit:elena:ip:${caller.ip || 'unknown'}`
      : `ratelimit:elena:student:${caller.studentId}`;
  }

  private globalKey(): string {
    return `ratelimit:elena:global:${new Date().toISOString().slice(0, 10)}`;
  }

  private async consume(
    key: string,
    max: number,
    ttlSeconds: number,
  ): Promise<boolean> {
    const distributed = await this.valkey?.enforce([{ key, max, ttlSeconds }]);
    if (distributed !== null && distributed !== undefined) return distributed;

    const current = this.cache.get<number>(key) ?? 0;
    if (current >= max) return false;
    this.cache.set(key, current + 1, ttlSeconds);
    return true;
  }

  /**
   * Frees a slot a caller is finished with, ahead of its TTL.
   *
   * The daily counters are deliberately NOT refunded: the session happened, and
   * refunding on "I'm done" would let a client take unlimited sessions by
   * ending each one immediately.
   *
   * Idempotent, and safe to call with an unknown id — releasing is only ever a
   * capability held by whoever was given the id at mint time, which is a random
   * UUID never shared with anyone else.
   */
  async release(sessionId: string): Promise<void> {
    this.localSlots.delete(sessionId);
    await this.valkey?.releaseConcurrent(CONCURRENT_KEY, sessionId);
    this.logger.log(
      JSON.stringify({ event: 'elena.session.released', sessionId }),
    );
  }

  /** Read-only look at the pool, so a full pool costs the caller nothing. */
  private async poolIsFull(): Promise<boolean> {
    const distributed = await this.valkey?.countConcurrent(
      CONCURRENT_KEY,
      this.sessionMaxSeconds,
    );
    if (distributed !== null && distributed !== undefined) {
      return distributed >= this.concurrentMax;
    }

    return this.pruneLocalSlots() >= this.concurrentMax;
  }

  private async takeConcurrentSlot(sessionId: string): Promise<boolean> {
    const distributed = await this.valkey?.trackConcurrent(
      CONCURRENT_KEY,
      sessionId,
      this.concurrentMax,
      this.sessionMaxSeconds,
    );
    if (distributed !== null && distributed !== undefined) return distributed;

    if (this.pruneLocalSlots() >= this.concurrentMax) return false;
    this.localSlots.set(
      sessionId,
      Date.now() + this.sessionMaxSeconds * 1000,
    );
    return true;
  }

  /** Drops expired slots and returns how many are still held. */
  private pruneLocalSlots(): number {
    const now = Date.now();
    for (const [member, expiresAt] of this.localSlots) {
      if (expiresAt <= now) this.localSlots.delete(member);
    }
    return this.localSlots.size;
  }

  private refuse(messageKey: string, message: string): HttpException {
    this.logger.log(
      JSON.stringify({ event: 'elena.session.refused', messageKey }),
    );
    return new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Too Many Requests',
        message,
        messageKey,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
