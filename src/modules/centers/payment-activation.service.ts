import { Injectable, NotFoundException } from '@nestjs/common';
import type { Tier } from '@prisma/client';
import { PrismaService } from '../../shared/services/prisma.service';

/**
 * How long one payment buys.
 *
 * A fixed day count rather than "one calendar month", so there is no
 * month-end arithmetic to get wrong (31 January plus a month) and it sits
 * alongside the day-based trial and grace constants.
 */
export const PAID_PERIOD_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Generous on purpose. This runs from a provider webhook, where a slow answer
 * costs nothing and a spurious failure makes the provider retry. Concurrent
 * activations for one center also queue behind each other's row locks, so the
 * second must be allowed to wait for the first.
 */
const ACTIVATION_TRANSACTION = { maxWait: 10_000, timeout: 20_000 };

export type ActivationOutcome = 'ACTIVATED' | 'ALREADY_ACTIVE';

export interface ActivationResult {
  outcome: ActivationOutcome;
  paymentId: string;
  centerId: string;
  paidUntil: Date | null;
}

export interface FailureResult {
  outcome: 'MARKED_FAILED' | 'UNCHANGED';
  paymentId: string;
}

/**
 * The one place a payment turns into access.
 *
 * Everything a successful payment changes happens here, in one transaction:
 * the payment's status, the center's seat rows, its plan and `paid_until`.
 * Provider code — the fake one today, Notch Pay tomorrow — verifies that money
 * moved and then calls `activate`. It never writes these tables itself. A
 * second writer is exactly how grandfathering or the exactly-once rule would
 * be broken.
 */
@Injectable()
export class PaymentActivationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grants what a payment bought, exactly once.
   *
   * EXACTLY ONCE comes from a compare-and-swap on the payment row: only a
   * payment not already SUCCEEDED is moved to SUCCEEDED, and a duplicated or
   * concurrent call updates zero rows and changes nothing else. The row lock
   * that update takes makes a concurrent second call wait, then find the
   * payment already settled.
   *
   * A payment marked FAILED or EXPIRED still activates. The provider is the
   * authority on whether money moved, and a success that arrives late has
   * still taken the center's money.
   *
   * SEATS ARE SET, NOT ADDED. A payment's lines are everything the center will
   * hold, the same "totals, not increments" meaning the quote has. Each line's
   * quantity AND price are written; stamping the line's price rather than
   * today's list price is what keeps grandfathering true, and it overwrites a
   * zero-priced trial seat with the paid one.
   *
   * A tier the center held but this payment does not cover is removed — but
   * only when no student holds it. A student is never left in a tier with no
   * seat row. (Product decision (a); keeping uncovered tiers instead is the
   * `removeUncoveredTiers` call below.)
   *
   * MONEY RECEIVED IS HONOURED. If students were provisioned between quote and
   * payment, the center may now be over its seats. Activation still succeeds:
   * refusing would take the money and grant nothing, and being over the limit
   * already blocks new provisioning without evicting anyone.
   */
  async activate(paymentId: string): Promise<ActivationResult> {
    return this.prisma.$transaction(async (tx) => {
      const settled = await tx.payment.updateMany({
        where: { id: paymentId, status: { not: 'SUCCEEDED' } },
        data: { status: 'SUCCEEDED', succeeded_at: new Date() },
      });

      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        select: {
          center_id: true,
          lines: { select: { tier: true, seats: true, unit_price_xaf: true } },
        },
      });

      if (!payment) {
        throw new NotFoundException('PAYMENT_NOT_FOUND');
      }

      if (settled.count === 0) {
        // Already applied. Report where the center stands and change nothing.
        const subscription = await tx.centerSubscription.findUnique({
          where: { center_id: payment.center_id },
          select: { paid_until: true },
        });

        return {
          outcome: 'ALREADY_ACTIVE',
          paymentId,
          centerId: payment.center_id,
          paidUntil: subscription?.paid_until ?? null,
        };
      }

      const paidUntil = await this.extendPaidPeriod(tx, payment.center_id);
      await this.setSeats(tx, payment.center_id, payment.lines);
      await this.removeUncoveredTiers(
        tx,
        payment.center_id,
        payment.lines.map((line) => line.tier),
      );

      return {
        outcome: 'ACTIVATED',
        paymentId,
        centerId: payment.center_id,
        paidUntil,
      };
    }, ACTIVATION_TRANSACTION);
  }

  /**
   * Records that the provider reported the payment failed.
   *
   * Only a PENDING payment moves, so a failure event arriving after the
   * success — out of order — can never undo access that was granted.
   */
  async markFailed(paymentId: string): Promise<FailureResult> {
    const moved = await this.prisma.payment.updateMany({
      where: { id: paymentId, status: 'PENDING' },
      data: { status: 'FAILED', failed_at: new Date() },
    });

    if (moved.count === 1) {
      return { outcome: 'MARKED_FAILED', paymentId };
    }

    const exists = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: { id: true },
    });

    if (!exists) {
      throw new NotFoundException('PAYMENT_NOT_FOUND');
    }

    return { outcome: 'UNCHANGED', paymentId };
  }

  /**
   * Adds one paid period, from the later of now and the current end.
   *
   * From the current end, so paying early does not throw away days already
   * bought; from now, so a lapsed center does not buy days in the past.
   *
   * The subscription row is locked first (`FOR UPDATE`). Two different
   * payments for one center activating at once would otherwise both read the
   * same `paid_until`, both add thirty days, and one period would be lost. With
   * the lock, the second waits, then reads the extended value. The new date is
   * computed here rather than in SQL because the column is a timestamp without
   * a time zone, and date arithmetic across the driver boundary can shift by
   * the local UTC offset.
   */
  private async extendPaidPeriod(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    centerId: string,
  ): Promise<Date> {
    const rows = await tx.$queryRaw<{ paid_until: Date | null }[]>`
      SELECT paid_until
        FROM center_subscriptions
       WHERE center_id = ${centerId}
         FOR UPDATE
    `;

    if (rows.length === 0) {
      throw new NotFoundException('CENTER_SUBSCRIPTION_NOT_FOUND');
    }

    const now = Date.now();
    const current = rows[0].paid_until?.getTime() ?? now;
    const paidUntil = new Date(
      Math.max(now, current) + PAID_PERIOD_DAYS * DAY_MS,
    );

    await tx.centerSubscription.update({
      where: { center_id: centerId },
      data: { plan: 'PAID', paid_until: paidUntil },
    });

    return paidUntil;
  }

  /** Each line's quantity and price, written onto its tier's seat row. */
  private async setSeats(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    centerId: string,
    lines: { tier: Tier; seats: number; unit_price_xaf: number }[],
  ): Promise<void> {
    for (const line of lines) {
      await tx.centerSeat.upsert({
        where: { center_id_tier: { center_id: centerId, tier: line.tier } },
        update: { quantity: line.seats, unit_price_xaf: line.unit_price_xaf },
        create: {
          center_id: centerId,
          tier: line.tier,
          quantity: line.seats,
          unit_price_xaf: line.unit_price_xaf,
        },
      });
    }
  }

  /**
   * Removes seat rows for tiers this payment does not cover, unless a student
   * still sits in that tier.
   *
   * The quote already refuses dropping a tier that has students. This guard
   * covers only the minutes between quote and payment, when a student could
   * have been moved into the tier.
   */
  private async removeUncoveredTiers(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    centerId: string,
    coveredTiers: Tier[],
  ): Promise<void> {
    const uncovered = await tx.centerSeat.findMany({
      where: { center_id: centerId, tier: { notIn: coveredTiers } },
      select: { tier: true },
    });

    for (const { tier } of uncovered) {
      const studentsInTier = await tx.student.count({
        where: { center_id: centerId, tier },
      });

      if (studentsInTier === 0) {
        await tx.centerSeat.delete({
          where: { center_id_tier: { center_id: centerId, tier } },
        });
      }
    }
  }
}
