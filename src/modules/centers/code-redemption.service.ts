import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivationCodeStatus, type CenterPlan } from '@prisma/client';
import { PrismaService } from '../../shared/services/prisma.service';
import { planIdFor, type PlanId } from '../../shared/plan-id';
import { normalizeActivationCode } from './activation-code-format';
import { SubscriptionPolicyService } from './subscription-policy.service';

export interface RedemptionResult {
  planId: PlanId;
  centerName: string;
  /** When this seat stops, or null when it follows the center's subscription. */
  expiresAt: Date | null;
}

interface CenterFacts {
  name: string;
  subscription: {
    plan: CenterPlan;
    trial_started_at: Date | null;
    trial_ends_at: Date | null;
    paid_until: Date | null;
  } | null;
}

/**
 * A student turning a code into access.
 *
 * Done once. After this the student simply logs in, and whether access still
 * holds is read on every request — so what this service guarantees is narrow:
 * one code becomes one student's, exactly once, and only while it is worth
 * something.
 */
@Injectable()
export class CodeRedemptionService {
  constructor(
    private readonly prisma: PrismaService,
    // The same policy the rest of the system reads. A second opinion on
    // "is this center active" is how one path grants what the other refuses.
    private readonly policy: SubscriptionPolicyService,
  ) {}

  async redeem(
    student: { studentId: string },
    typed: string,
    ip: string | undefined,
  ): Promise<RedemptionResult> {
    const value = normalizeActivationCode(typed);

    // Malformed and unknown get the same answer, so the response cannot be
    // used to learn which shapes are real codes.
    if (!value) {
      throw new BadRequestException('CODE_INVALID');
    }

    const code = await this.prisma.activationCode.findUnique({
      where: { code: value },
      include: {
        center: {
          select: {
            name: true,
            subscription: {
              select: {
                plan: true,
                trial_started_at: true,
                trial_ends_at: true,
                paid_until: true,
              },
            },
          },
        },
      },
    });

    if (!code) {
      throw new BadRequestException('CODE_INVALID');
    }

    // Re-entering one's own code is a student confused about whether it
    // worked, not an attack. Answer with what they already have.
    if (
      code.status === ActivationCodeStatus.CONNECTED &&
      code.student_id === student.studentId
    ) {
      return this.toResult(code.tier, code.center, code.expires_at);
    }

    if (code.status === ActivationCodeStatus.CONNECTED) {
      throw new ConflictException('CODE_ALREADY_USED');
    }

    if (code.status === ActivationCodeStatus.DEACTIVATED) {
      throw new ConflictException('CODE_DEACTIVATED');
    }

    if (code.expires_at !== null && code.expires_at <= new Date()) {
      throw new BadRequestException('CODE_EXPIRED');
    }

    // A code is only worth what its center is paying for. Without this, a
    // lapsed center's unused codes would keep letting new students in.
    if (
      !code.center.subscription ||
      !this.policy.evaluate(code.center.subscription).studentsMayLearn
    ) {
      throw new ForbiddenException('CENTER_NOT_ACTIVE');
    }

    // Refused rather than switched. The usual cause is a mistake, and moving
    // the student would silently waste the seat they already hold; moving a
    // student between codes is the center's job.
    const alreadyHeld = await this.prisma.activationCode.findFirst({
      where: {
        student_id: student.studentId,
        status: ActivationCodeStatus.CONNECTED,
        OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
      },
      select: { id: true },
    });

    if (alreadyHeld) {
      throw new ConflictException('STUDENT_ALREADY_ACTIVE');
    }

    const holder = await this.prisma.student.findUnique({
      where: { id: student.studentId },
      select: { first_name: true, last_name: true, email: true },
    });

    if (!holder) {
      throw new NotFoundException('STUDENT_NOT_FOUND');
    }

    await this.prisma.$transaction(async (tx) => {
      // The gate. Only a code still waiting moves, so of two students sending
      // the same code at the same moment exactly one wins.
      const claimed = await tx.activationCode.updateMany({
        where: { id: code.id, status: ActivationCodeStatus.ACTIVATED },
        data: {
          status: ActivationCodeStatus.CONNECTED,
          student_id: student.studentId,
          // Copied rather than joined, so the center still sees who held the
          // seat after the student changes their name or leaves.
          linked_name:
            [holder.first_name, holder.last_name].filter(Boolean).join(' ') ||
            null,
          linked_email: holder.email,
          connected_at: new Date(),
          // A center holds its codes and can redeem one itself. This is the
          // trace that makes that visible afterwards.
          connected_ip: ip ?? null,
        },
      });

      if (claimed.count !== 1) {
        throw new ConflictException('CODE_ALREADY_USED');
      }

      // What access is read from on every request. Set in the same
      // transaction as the claim, so a code can never be taken without the
      // student actually getting the seat.
      await tx.student.update({
        where: { id: student.studentId },
        data: { center_id: code.center_id, tier: code.tier },
      });

      await tx.activationCodeEvent.create({
        data: {
          code_id: code.id,
          center_id: code.center_id,
          // Nobody at the center acted: the student did.
          center_user_id: null,
          from_status: ActivationCodeStatus.ACTIVATED,
          to_status: ActivationCodeStatus.CONNECTED,
          student_id: student.studentId,
        },
      });
    });

    return this.toResult(code.tier, code.center, code.expires_at);
  }

  private toResult(
    tier: Parameters<typeof planIdFor>[0],
    center: CenterFacts,
    expiresAt: Date | null,
  ): RedemptionResult {
    return { planId: planIdFor(tier), centerName: center.name, expiresAt };
  }
}
