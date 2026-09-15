import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import type { PaymentStatus, Tier } from '@prisma/client';
import type { CenterAccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { PrismaService } from '../../shared/services/prisma.service';
import { PricingService, type SeatMix } from './pricing.service';
import { CenterSeatsService } from './center-seats.service';
import { deriveOnboardingState } from './center-onboarding';

/**
 * The manager is carried as well as the center, because profile completeness
 * asks about the signed-in manager's phone — the same manager the dashboard
 * asks about, so both surfaces answer alike.
 */
type SignedCenterIdentity = Pick<
  CenterAccessTokenPayload,
  'centerId' | 'centerUserId'
>;

export interface PaymentLineView {
  tier: Tier;
  seats: number;
  unitPriceXaf: number;
  amountXaf: number;
}

export interface PaymentView {
  id: string;
  /** Per tier, so an invoice can be read back exactly as it was agreed. */
  lines: PaymentLineView[];
  totalSeats: number;
  amountXaf: number;
  status: PaymentStatus;
  createdAt: Date;
}

export interface PaymentPage {
  payments: PaymentView[];
  total: number;
  page: number;
  pageSize: number;
}

/** Prisma's unique-violation code. The insert race is decided by this. */
const UNIQUE_VIOLATION = 'P2002';

/** The column that makes a P2002 a replay rather than a bug. */
const IDEMPOTENCY_COLUMN = 'idempotency_key';

/** Cheapest first, matching the order a quote lists its lines in. */
const TIER_VIEW_ORDER: Record<Tier, number> = { START: 0, PRO: 1, PREMIUM: 2 };

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly seats: CenterSeatsService,
  ) {}

  /**
   * Records a center's intent to pay for seats.
   *
   * Grants nothing. `paid_until` and `seats` are not touched here and must not
   * be — only a verified provider event may move them, in Phase 7.
   *
   * The amount is computed from the center's own terms at the moment of
   * creation and copied onto the row. The caller contributes a seat count and
   * an idempotency key, and nothing else it sends can reach the price.
   */
  async create(
    identity: SignedCenterIdentity,
    mix: SeatMix,
    idempotencyKey: string,
  ): Promise<PaymentView> {
    // Shape-checked before a transaction is opened: an unusable mix should not
    // hold a connection, and the refusal does not depend on any row.
    const wanted = this.pricing.requireMix(mix);
    const requestHash = this.fingerprint(identity.centerId, wanted);

    // Before anything is priced or written. A center can run a trial on an
    // email address alone, but taking money needs a country for currency and
    // tax, a city for support, and a phone to chase an unpaid invoice — so the
    // gate sits here rather than at provisioning. Quoting stays open, because
    // looking at a price is not a commitment.
    await this.assertProfileComplete(identity);

    try {
      // Priced and written in one transaction, so a refused quote leaves no
      // row and a payment never exists without its lines.
      //
      // What this does NOT guarantee: the transaction is READ COMMITTED, so a
      // price stamp or a provisioning run committing between the reads and the
      // insert is not seen. That is accepted rather than fixed with
      // Serializable, which would turn the same-key insert race below into
      // serialization failures and 500s. Nothing here moves money or grants
      // access, and the guarantees that matter live in
      // PaymentActivationService: it stamps each line's own price, sets seats
      // exactly once, and honours a payment even if students were added in
      // the meantime.
      const created = await this.prisma.$transaction(async (tx) => {
        const quote = this.pricing.quote(
          wanted,
          await this.seats.pricingContextFor(identity.centerId, tx),
        );

        return tx.payment.create({
          data: {
            center_id: identity.centerId,
            total_seats: quote.totalSeats,
            amount_xaf: quote.totalXaf,
            idempotency_key: idempotencyKey,
            request_hash: requestHash,
            // Written in the same insert as the payment, so a payment can
            // never exist without the breakdown that explains its amount.
            lines: {
              create: quote.lines.map((line) => ({
                tier: line.tier,
                seats: line.seats,
                unit_price_xaf: line.unitPriceXaf,
                amount_xaf: line.amountXaf,
              })),
            },
          },
          include: { lines: true },
        });
      });

      return this.toView(created);
    } catch (error) {
      if (!this.isIdempotencyViolation(error)) {
        throw error;
      }

      // Lost the insert race, or this is a straightforward retry. Either way
      // the row that won is the answer — provided it was the same intent.
      return this.reconcileReplay(
        identity.centerId,
        idempotencyKey,
        requestHash,
      );
    }
  }

  /**
   * Refuses a center that has not finished its profile, naming every field it
   * still owes.
   *
   * The `missing` list is what makes the refusal actionable: a client renders
   * the remaining checklist from it rather than holding a second copy of the
   * rules, so a fourth required field changes nothing on the frontend.
   */
  private async assertProfileComplete(
    identity: SignedCenterIdentity,
  ): Promise<void> {
    const manager = await this.prisma.centerUser.findFirst({
      // Scoped by center as well as id, so a manager id from another center
      // cannot be used to answer this question.
      where: { id: identity.centerUserId, center_id: identity.centerId },
      select: {
        phone: true,
        center: { select: { country: true, city: true } },
      },
    });

    if (!manager) {
      throw new NotFoundException('CENTER_NOT_FOUND');
    }

    const onboarding = deriveOnboardingState({
      country: manager.center.country,
      city: manager.center.city,
      phone: manager.phone,
    });

    if (!onboarding.complete) {
      throw new ForbiddenException({
        message: 'CENTER_PROFILE_INCOMPLETE',
        missing: onboarding.missing,
      });
    }
  }

  async get(
    identity: SignedCenterIdentity,
    paymentId: string,
  ): Promise<PaymentView> {
    const payment = await this.prisma.payment.findFirst({
      // Scoped by center in the query itself. Fetching then comparing would
      // work too, and would be one refactor away from leaking.
      where: { id: paymentId, center_id: identity.centerId },
      include: { lines: true },
    });

    // 404 rather than 403 for another center's payment, matching the student
    // routes: a 403 confirms the id exists, which is itself an answer.
    if (!payment) {
      throw new NotFoundException('PAYMENT_NOT_FOUND');
    }

    return this.toView(payment);
  }

  async list(
    identity: SignedCenterIdentity,
    { page, pageSize }: { page: number; pageSize: number },
  ): Promise<PaymentPage> {
    const where = { center_id: identity.centerId };

    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        // Two keys, because `created_at` is TIMESTAMP(3) and two payments can
        // land in the same millisecond. A tie makes the sort unstable, and an
        // unstable sort across pages can show one row twice and another never.
        // The id is a uuid, so it says nothing about time — it is here only to
        // break the tie the same way on every request.
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { lines: true },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      payments: rows.map((row) => this.toView(row)),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Answers a request whose key was already used.
   *
   * Same intent, same answer: the original record, so a retried or
   * double-clicked request is harmless. Different intent, refusal: returning
   * the original would tell a client it had bought 20 seats when the row says
   * 10, and that disagreement would only surface at reconciliation.
   */
  private async reconcileReplay(
    centerId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<PaymentView> {
    const existing = await this.prisma.payment.findUnique({
      where: {
        center_id_idempotency_key: {
          center_id: centerId,
          idempotency_key: idempotencyKey,
        },
      },
      include: { lines: true },
    });

    // Only reachable if the row disappeared between the failed insert and this
    // read. Rethrowing the conflict is safer than retrying into a loop.
    if (!existing) {
      throw new ConflictException('IDEMPOTENCY_KEY_REUSED');
    }

    if (existing.request_hash !== requestHash) {
      throw new ConflictException('IDEMPOTENCY_KEY_REUSED');
    }

    return this.toView(existing);
  }

  /**
   * What the key was first used for.
   *
   * Covers the center and every tier, so a replay that changes any part of the
   * mix is a different intent wearing the same name. Hashing only the total
   * would let five Start plus five Pro pass as ten Start, which is the one
   * collision that matters.
   *
   * It covers the seats and NOT the price, because a fingerprint has to
   * identify the caller's intent and the price is the server's answer to it.
   * An earlier version hashed the priced lines, which meant a stamped price
   * changing between an attempt and its retry — the by-hand stamping workflow,
   * or the planned 4,500 to 4,800 move — turned a byte-identical retry into
   * IDEMPOTENCY_KEY_REUSED. A client following the documented contract answers
   * that with a fresh key, producing a second payment for one intent: exactly
   * what the unique index exists to prevent.
   *
   * Sorted by tier so the hash cannot depend on key order, and the center is
   * included so a hash can never be compared across centers by accident.
   */
  private fingerprint(centerId: string, mix: SeatMix): string {
    const seats = Object.entries(mix).sort(([a], [b]) => a.localeCompare(b));

    return createHash('sha256')
      .update(JSON.stringify({ centerId, seats }))
      .digest('hex');
  }

  /**
   * Whether this error is the idempotency index rejecting a duplicate.
   *
   * The constraint is checked, not just the code. `payment_lines` has a unique
   * index of its own in the same transaction, so treating any P2002 as a
   * replay would look for a row by idempotency key, not find one, and answer a
   * server bug with 409 IDEMPOTENCY_KEY_REUSED — a client error the client
   * cannot act on and nobody can debug from the response.
   */
  private isIdempotencyViolation(error: unknown): boolean {
    if (
      typeof error !== 'object' ||
      error === null ||
      (error as { code?: unknown }).code !== UNIQUE_VIOLATION
    ) {
      return false;
    }

    return this.violatedColumns(error).includes(IDEMPOTENCY_COLUMN);
  }

  /**
   * Which columns a unique violation names.
   *
   * Two shapes, because this runs on the `PrismaPg` driver adapter. The
   * adapter reports the constraint under `meta.driverAdapterError`, and
   * `meta.target` — what Prisma's own engine sets, and what the documentation
   * describes — is simply absent. Reading only `target` therefore matched
   * nothing and quietly turned every replay back into a 500, which is how this
   * function earned its test.
   *
   * Both are read so the behaviour does not depend on which one a future
   * Prisma release populates.
   */
  private violatedColumns(error: object): string[] {
    const meta = (error as { meta?: Record<string, unknown> }).meta ?? {};

    const target = meta.target;
    if (Array.isArray(target)) {
      return target.map(String);
    }
    if (typeof target === 'string') {
      return [target];
    }

    const fields = (
      meta as {
        driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } };
      }
    ).driverAdapterError?.cause?.constraint?.fields;

    return Array.isArray(fields) ? fields.map(String) : [];
  }

  /** Built field by field, so a column added later cannot leak into a response. */
  private toView(row: {
    id: string;
    total_seats: number;
    amount_xaf: number;
    status: PaymentStatus;
    created_at: Date;
    lines: {
      tier: Tier;
      seats: number;
      unit_price_xaf: number;
      amount_xaf: number;
    }[];
  }): PaymentView {
    return {
      id: row.id,
      // Cheapest tier first, matching the order a quote lists them in, so a
      // payment and the quote that produced it read the same way.
      lines: [...row.lines]
        .sort((a, b) => TIER_VIEW_ORDER[a.tier] - TIER_VIEW_ORDER[b.tier])
        .map((line) => ({
          tier: line.tier,
          seats: line.seats,
          unitPriceXaf: line.unit_price_xaf,
          amountXaf: line.amount_xaf,
        })),
      totalSeats: row.total_seats,
      amountXaf: row.amount_xaf,
      status: row.status,
      createdAt: row.created_at,
    };
  }
}
