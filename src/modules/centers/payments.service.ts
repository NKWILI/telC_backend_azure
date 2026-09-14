import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import type { PaymentStatus, Tier } from '@prisma/client';
import type { CenterAccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { PrismaService } from '../../shared/services/prisma.service';
import { PricingService, type SeatMix, type Quote } from './pricing.service';
import { CenterSeatsService } from './center-seats.service';

type SignedCenterIdentity = Pick<CenterAccessTokenPayload, 'centerId'>;

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
    // Priced before anything is written, so a refused mix leaves no record
    // behind.
    const quote = this.pricing.quote(
      mix,
      await this.seats.tierContextFor(identity.centerId),
    );

    const requestHash = this.fingerprint(identity.centerId, quote);

    try {
      const created = await this.prisma.payment.create({
        data: {
          center_id: identity.centerId,
          total_seats: quote.totalSeats,
          amount_xaf: quote.totalXaf,
          idempotency_key: idempotencyKey,
          request_hash: requestHash,
          // Written in the same insert as the payment, so a payment can never
          // exist without the breakdown that explains its amount.
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

      return this.toView(created);
    } catch (error) {
      if (!this.isUniqueViolation(error)) {
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
        orderBy: { created_at: 'desc' },
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
   * Covers the center and every tier line, so a replay that changes any part
   * of the mix is a different intent wearing the same name. Hashing only the
   * total would let five Start plus five Pro pass as ten Start at the same
   * price, which is the one collision that matters.
   *
   * The center is included so a hash can never be compared across centers by
   * accident.
   */
  private fingerprint(centerId: string, quote: Quote): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          centerId,
          lines: quote.lines.map((line) => [
            line.tier,
            line.seats,
            line.unitPriceXaf,
          ]),
        }),
      )
      .digest('hex');
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === UNIQUE_VIOLATION
    );
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
