/**
 * What a reset promises is about the database, not the service: the old value
 * really stops existing, and the student who held it really loses the seat.
 *
 * Runs against the disposable branch in `.env.test`, over the direct endpoint.
 */
import * as bcrypt from 'bcryptjs';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../src/shared/services/prisma.service';
import { SubscriptionPolicyService } from '../src/modules/centers/subscription-policy.service';
import { CodeRedemptionService } from '../src/modules/centers/code-redemption.service';
import { CenterActivationCodesService } from '../src/modules/centers/center-activation-codes.service';
import { generateActivationCode } from '../src/modules/centers/activation-code-format';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY_MS);

const prisma = new PrismaService();
const redemption = new CodeRedemptionService(
  prisma,
  new SubscriptionPolicyService(),
);
const codes = new CenterActivationCodesService(prisma);

async function wipe() {
  await prisma.student.deleteMany({
    where: { email: { endsWith: '@reset.integration.test' } },
  });
  await prisma.center.deleteMany({
    where: { name: { startsWith: 'Reset Test' } },
  });
}

async function centerOnTrialWithCode() {
  const center = await prisma.center.create({
    data: {
      name: `Reset Test ${Date.now()}-${Math.random()}`,
      subscription: {
        create: {
          plan: 'TRIAL',
          trial_started_at: daysFromNow(-1),
          trial_ends_at: daysFromNow(13),
        },
      },
    },
  });
  const code = await prisma.activationCode.create({
    data: {
      center_id: center.id,
      code: generateActivationCode(),
      tier: 'START',
      expires_at: daysFromNow(13),
    },
  });
  return { center, code };
}

async function makeStudent() {
  return prisma.student.create({
    data: {
      email: `s-${Date.now()}-${Math.random()}@reset.integration.test`,
      first_name: 'Amina',
      last_name: 'Nguema',
      password_hash: await bcrypt.hash('x', 4),
      email_verified: true,
    },
  });
}

describe('resetting a code against real Postgres', () => {
  beforeEach(wipe);

  afterAll(async () => {
    await wipe();
    await prisma.onModuleDestroy();
  });

  it('gives the seat a new value, cuts the holder off, and kills the old value', async () => {
    const { center, code } = await centerOnTrialWithCode();
    const amina = await makeStudent();
    await redemption.redeem({ studentId: amina.id }, code.code, 'ip');

    const manager = { centerId: center.id, centerUserId: 'owner-1' } as never;
    const reset = await codes.reset(manager, code.id);

    // Same seat, new value, waiting for its next student.
    expect(reset.id).toBe(code.id);
    expect(reset.code).not.toBe(code.code);
    expect(reset.status).toBe('activated');

    // The holder is off the school at once.
    const after = await prisma.student.findUnique({ where: { id: amina.id } });
    expect(after!.center_id).toBeNull();

    // The old value is simply gone: typing it is an unknown code.
    const other = await makeStudent();
    await expect(
      redemption.redeem({ studentId: other.id }, code.code, 'ip'),
    ).rejects.toThrow(new BadRequestException('CODE_INVALID'));

    // The new one works for the next student.
    await expect(
      redemption.redeem({ studentId: other.id }, reset.code, 'ip'),
    ).resolves.toMatchObject({ planId: 'start' });

    // And the log remembers what was replaced.
    const logged = await prisma.activationCodeEvent.findFirst({
      where: { code_id: code.id, previous_code: { not: null } },
    });
    expect(logged!.previous_code).toBe(code.code);
    expect(logged!.student_id).toBe(amina.id);
  });

  it('allows one reset of a used trial code, and refuses the second', async () => {
    const { center, code } = await centerOnTrialWithCode();
    const manager = { centerId: center.id, centerUserId: 'owner-1' } as never;

    const first = await makeStudent();
    await redemption.redeem({ studentId: first.id }, code.code, 'ip');
    const once = await codes.reset(manager, code.id);

    const second = await makeStudent();
    await redemption.redeem({ studentId: second.id }, once.code, 'ip');

    await expect(codes.reset(manager, code.id)).rejects.toMatchObject({
      response: { message: 'CODE_RESET_LIMIT_REACHED' },
    });
  });
});
