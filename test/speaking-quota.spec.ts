import { ForbiddenException } from '@nestjs/common';
import { EvaluationService } from '../src/modules/speaking/services/evaluation.service';
import { SpeakingController } from '../src/modules/speaking/speaking.controller';
import { JwtAuthGuard } from '../src/shared/guards/jwt-auth.guard';
import { GuestBlockGuard } from '../src/shared/guards/guest-block.guard';
import { StudentSubscriptionGuard } from '../src/shared/guards/student-subscription.guard';

/**
 * The quota where it actually costs money.
 *
 * Two orderings are the whole task, and getting either backwards is a defect
 * nobody would see in a happy-path test:
 *
 *  - the check runs BEFORE the AI call, or a student over their allowance
 *    still costs us a Gemini request;
 *  - the row is written AFTER it succeeds, or our own outage spends a Start
 *    student's session and hands them nothing.
 */
describe('speaking evaluation and the AI quota', () => {
  /** The shape `parseResponse` actually accepts, snake_case and all. */
  const A_RESULT = {
    grammar_score: 4,
    vocabulary_score: 4,
    coherence_score: 4,
    overall_score: 4,
    evaluation_text: 'Gut gemacht.',
    corrections: [],
  };

  let gemini: { generateTextResponse: jest.Mock };
  let quota: { assertWithinQuota: jest.Mock };
  let usage: { recordDelivered: jest.Mock };
  let rateLimit: { checkAiEvaluationLimit: jest.Mock };
  let prisma: any;
  let service: EvaluationService;

  beforeEach(() => {
    prisma = {
      speakingAttempt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      student: { findUnique: jest.fn().mockResolvedValue({ id: 'student-1' }) },
      studentActivity: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((work: any) => work(prisma)),
    };
    gemini = {
      generateTextResponse: jest
        .fn()
        .mockResolvedValue(JSON.stringify(A_RESULT)),
    };
    quota = { assertWithinQuota: jest.fn().mockResolvedValue(undefined) };
    usage = { recordDelivered: jest.fn().mockResolvedValue(undefined) };
    rateLimit = {
      checkAiEvaluationLimit: jest.fn().mockResolvedValue(undefined),
    };

    service = new EvaluationService(
      gemini as never,
      quota as never,
      usage as never,
      rateLimit as never,
      prisma as never,
    );
  });

  const evaluate = (studentId: string | undefined = 'student-1') =>
    service.evaluateTranscript(studentId, 1, 'Ich heiße Awa und ich wohne...');

  /** Explicitly anonymous. Not `evaluate(undefined)`: passing undefined to a
   *  parameter with a default silently uses the default. */
  const evaluateAnonymously = () =>
    service.evaluateTranscript(undefined, 1, 'Ich heiße Awa...');

  describe('before the AI call', () => {
    it('checks the allowance', async () => {
      await evaluate();

      expect(quota.assertWithinQuota).toHaveBeenCalledWith(
        'student-1',
        'SPEAKING_EVALUATION',
      );
    });

    it('does not call Gemini when the allowance is spent', async () => {
      // The point of checking first. A refusal after the call would cost us
      // the request and give the student nothing.
      quota.assertWithinQuota.mockRejectedValue(
        new ForbiddenException({ message: 'AI_QUOTA_EXCEEDED' }),
      );

      await expect(evaluate()).rejects.toThrow('AI_QUOTA_EXCEEDED');
      expect(gemini.generateTextResponse).not.toHaveBeenCalled();
    });

    it('records nothing when the allowance is spent', async () => {
      quota.assertWithinQuota.mockRejectedValue(
        new ForbiddenException({ message: 'AI_QUOTA_EXCEEDED' }),
      );

      await expect(evaluate()).rejects.toThrow('AI_QUOTA_EXCEEDED');
      expect(usage.recordDelivered).not.toHaveBeenCalled();
    });

    it('lets the refusal through unchanged, numbers and all', async () => {
      // The refusal is a sales moment. Wrapping it would strip the figures a
      // client needs to offer the upgrade.
      const refusal = new ForbiddenException({
        message: 'AI_QUOTA_EXCEEDED',
        tier: 'START',
        usedToday: 2,
        allowedToday: 2,
      });
      quota.assertWithinQuota.mockRejectedValue(refusal);

      await expect(evaluate()).rejects.toBe(refusal);
    });
  });

  describe('after the AI call', () => {
    it('records one operation on success', async () => {
      await evaluate();

      expect(usage.recordDelivered).toHaveBeenCalledWith(
        'student-1',
        'SPEAKING_EVALUATION',
      );
    });

    it('records nothing when Gemini fails', async () => {
      // Metered APIs do not bill a 500. A Gemini failure must not spend one
      // of a Start student's two daily sessions.
      gemini.generateTextResponse.mockRejectedValue(new Error('upstream down'));

      await expect(evaluate()).rejects.toThrow();
      expect(usage.recordDelivered).not.toHaveBeenCalled();
    });

    it('records nothing when the response cannot be parsed', async () => {
      // A reply we cannot use is not a session the student had.
      gemini.generateTextResponse.mockResolvedValue('not json at all');

      await expect(evaluate()).rejects.toThrow();
      expect(usage.recordDelivered).not.toHaveBeenCalled();
    });

    it('still returns the evaluation when the meter cannot be written', async () => {
      // recordDelivered swallows its own failures; this asserts the caller
      // does not reintroduce one. The student has earned this result.
      usage.recordDelivered.mockRejectedValue(new Error('offline'));

      await expect(evaluate()).resolves.toMatchObject({
        evaluationText: 'Gut gemacht.',
      });
    });
  });

  describe('the order is not an accident', () => {
    it('checks, then calls, then records', async () => {
      const order: string[] = [];
      rateLimit.checkAiEvaluationLimit.mockImplementation(() => {
        order.push('limit');
        return Promise.resolve();
      });
      quota.assertWithinQuota.mockImplementation(() => {
        order.push('check');
        return Promise.resolve();
      });
      gemini.generateTextResponse.mockImplementation(() => {
        order.push('call');
        return Promise.resolve(JSON.stringify(A_RESULT));
      });
      usage.recordDelivered.mockImplementation(() => {
        order.push('record');
        return Promise.resolve();
      });

      await evaluate();

      expect(order).toEqual(['limit', 'check', 'call', 'record']);
    });
  });

  describe('keeping the result (D26)', () => {
    const ID = '6f1c1f5e-2b1a-4b8e-9a51-0c0de0c0de00';

    it('stores the evaluation and records Sprechen activity together', async () => {
      await service.evaluateTranscript('student-1', 2, 'Ich heiße Awa...', {
        durationSeconds: 120,
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const stored = prisma.speakingAttempt.create.mock.calls[0][0].data;
      expect(stored).toMatchObject({
        student_id: 'student-1',
        teil_number: 2,
        score: 4,
        duration_seconds: 120,
      });
      expect(prisma.studentActivity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          skill: 'SPRECHEN',
          teil: 2,
          score: 4,
          attempt_id: stored.attempt_id,
        }),
      });
    });

    it('answers a repeated attempt from storage, spending nothing', async () => {
      const earlier = { scores: { overall: 70 }, evaluationText: 'Früher.' };
      prisma.speakingAttempt.findUnique.mockResolvedValue({
        student_id: 'student-1',
        evaluation: earlier,
      });

      const result = await service.evaluateTranscript(
        'student-1',
        1,
        'Ich...',
        {
          attemptId: ID,
        },
      );

      expect(result).toEqual(earlier);
      expect(quota.assertWithinQuota).not.toHaveBeenCalled();
      expect(gemini.generateTextResponse).not.toHaveBeenCalled();
      expect(prisma.speakingAttempt.create).not.toHaveBeenCalled();
    });

    it("refuses an attempt id that is another student's", async () => {
      prisma.speakingAttempt.findUnique.mockResolvedValue({
        student_id: 'student-2',
        evaluation: {},
      });

      await expect(
        service.evaluateTranscript('student-1', 1, 'Ich...', { attemptId: ID }),
      ).rejects.toThrow('ATTEMPT_ID_TAKEN');
      expect(gemini.generateTextResponse).not.toHaveBeenCalled();
    });

    it('still returns the evaluation when it cannot be stored', async () => {
      prisma.$transaction.mockRejectedValue(new Error('db down'));

      await expect(evaluate()).resolves.toMatchObject({
        scores: expect.objectContaining({ overall: 4 }),
      });
    });
  });

  describe('a request with no student', () => {
    it('is neither checked nor recorded', async () => {
      // The same choice StudentSubscriptionGuard makes: a token naming nobody
      // has nobody to look up. Charging an anonymous caller is impossible, and
      // refusing them here would be a decision about authentication taken in
      // the wrong place.
      await expect(evaluateAnonymously()).resolves.toBeDefined();

      expect(quota.assertWithinQuota).not.toHaveBeenCalled();
      expect(usage.recordDelivered).not.toHaveBeenCalled();
    });
  });
});

/**
 * The door, as opposed to the meter.
 *
 * A guest token is the one caller the quota could never count: it carries a
 * random uuid and no `students` row, so every `ai_usage` insert fails the
 * foreign key and `recordDelivered` swallows it. Unmetered paid calls, no
 * credentials required. `GuestBlockGuard` was written for exactly this, was
 * promised by the guest-session documentation, and was mounted nowhere.
 */
describe('the guards on the speaking controller', () => {
  const guardsOn = (target: object): unknown[] =>
    (Reflect.getMetadata('__guards__', target) ?? []) as unknown[];

  it('refuses guests before anything costs money', () => {
    expect(guardsOn(SpeakingController)).toContain(GuestBlockGuard);
  });

  it('still authenticates and still checks the subscription', () => {
    const guards = guardsOn(SpeakingController);

    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(StudentSubscriptionGuard);
  });

  it('identifies the caller before deciding whether they are a guest', () => {
    // GuestBlockGuard reads request.student, which JwtAuthGuard puts there.
    // Reversed, it would see no student, find no isGuest flag, and admit
    // every guest — a guard that looks like protection and is not.
    const guards = guardsOn(SpeakingController);

    expect(guards.indexOf(JwtAuthGuard)).toBeLessThan(
      guards.indexOf(GuestBlockGuard),
    );
  });
});
