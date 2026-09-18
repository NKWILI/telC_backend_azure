/**
 * Whether one student can end up holding two schools' seats is a claim about
 * Postgres, not about our mocks.
 *
 * The unit suite proves the service reads everything inside its transaction.
 * Only this proves the database's own rule — one connected code per student —
 * turns two simultaneous redemptions into exactly one.
 *
 * Runs against the disposable branch in `.env.test`, over the direct endpoint.
 */
import * as bcrypt from 'bcryptjs';
import { ConflictException } from '@nestjs/common';
import type { ActivationCode } from '@prisma/client';
import { PrismaService } from '../src/shared/services/prisma.service';
import { SubscriptionPolicyService } from '../src/modules/centers/subscription-policy.service';
import { CodeRedemptionService } from '../src/modules/centers/code-redemption.service';
import { generateActivationCode } from '../src/modules/centers/activation-code-format';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY_MS);

const prisma = new PrismaService();
const redemption = new CodeRedemptionService(
  prisma,
  new SubscriptionPolicyService(),
);

async function wipe() {
  await prisma.student.deleteMany({
    where: { email: { endsWith: '@redeem.integration.test' } },
  });
  await prisma.center.deleteMany({
    where: { name: { startsWith: 'Redeem Test' } },
  });
}

/** A center on a live trial, with `count` fresh codes. */
async function centerWithCodes(count: number) {
  const center = await prisma.center.create({
    data: {
      name: `Redeem Test ${Date.now()}-${Math.random()}`,
      subscription: {
        create: {
          plan: 'TRIAL',
          trial_started_at: daysFromNow(-1),
          trial_ends_at: daysFromNow(13),
        },
      },
    },
  });

  const codes: ActivationCode[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(
      await prisma.activationCode.create({
        data: {
          center_id: center.id,
          code: generateActivationCode(),
          tier: 'START',
          expires_at: daysFromNow(13),
        },
      }),
    );
  }

  return { center, codes };
}

async function makeStudent() {
  return prisma.student.create({
    data: {
      email: `s-${Date.now()}-${Math.random()}@redeem.integration.test`,
      first_name: 'Amina',
      last_name: 'Nguema',
      password_hash: await bcrypt.hash('x', 4),
      email_verified: true,
    },
  });
}

describe('code redemption against real Postgres', () => {
  beforeEach(wipe);

  afterAll(async () => {
    await wipe();
    // onModuleDestroy, not $disconnect: the latter leaves the pg pool open.
    await prisma.onModuleDestroy();
  });

  it('gives one student one seat when they redeem two codes at the same instant', async () => {
    const first = await centerWithCodes(1);
    const second = await centerWithCodes(1);
    const student = await makeStudent();

    const outcomes = await Promise.allSettled([
      redemption.redeem({ studentId: student.id }, first.codes[0].code, 'ip'),
      redemption.redeem({ studentId: student.id }, second.codes[0].code, 'ip'),
    ]);

    const won = outcomes.filter((o) => o.status === 'fulfilled');
    const lost = outcomes.filter((o) => o.status === 'rejected');

    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0].reason).toBeInstanceOf(ConflictException);

    const connected = await prisma.activationCode.count({
      where: { student_id: student.id, status: 'CONNECTED' },
    });
    expect(connected).toBe(1);
  });

  it('refuses a second connected code at the database, whatever the service does', async () => {
    const { codes } = await centerWithCodes(2);
    const student = await makeStudent();

    await prisma.activationCode.update({
      where: { id: codes[0].id },
      data: { status: 'CONNECTED', student_id: student.id },
    });

    // Straight past the service: the rule must hold even for a writer that
    // forgot to check.
    await expect(
      prisma.activationCode.update({
        where: { id: codes[1].id },
        data: { status: 'CONNECTED', student_id: student.id },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('lets a student whose code ran out redeem a new one', async () => {
    const old = await centerWithCodes(1);
    const fresh = await centerWithCodes(1);
    const student = await makeStudent();

    await prisma.activationCode.update({
      where: { id: old.codes[0].id },
      data: {
        status: 'CONNECTED',
        student_id: student.id,
        expires_at: daysFromNow(-1),
      },
    });

    await expect(
      redemption.redeem({ studentId: student.id }, fresh.codes[0].code, 'ip'),
    ).resolves.toMatchObject({ planId: 'start' });

    const released = await prisma.activationCode.findUnique({
      where: { id: old.codes[0].id },
    });
    expect(released!.status).toBe('DEACTIVATED');
  });
});
