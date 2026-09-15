import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { AiQuotaService } from '../../../shared/services/ai-quota.service';
import { AiUsageService } from '../../../shared/services/ai-usage.service';
import {
  SpeakingEvaluationResponseDto,
  CorrectionDto,
  ScoresDto,
} from '../dto/evaluation-response.dto';

@Injectable()
export class EvaluationService {
  private readonly logger = new Logger(EvaluationService.name);
  private readonly EVALUATION_TIMEOUT_MS = 30000;

  constructor(
    private readonly geminiService: GeminiService,
    private readonly quota: AiQuotaService,
    private readonly usage: AiUsageService,
  ) {}

  /**
   * Evaluates a transcript, and meters it.
   *
   * The metering lives here rather than in the controller so it cannot be
   * bypassed by a second caller. `studentId` is therefore a parameter rather
   * than something the caller optionally remembers to check.
   *
   * The two orderings are the point:
   *
   * The allowance is checked BEFORE the call. Checking afterwards would let a
   * student over their limit still cost us a Gemini request, which is the
   * expense the quota exists to bound.
   *
   * The row is written AFTER the call succeeds, and only then. Charging on the
   * attempt would make the student pay for our outage: a Gemini failure would
   * spend one of a Start student's two daily sessions and hand them nothing,
   * and a bad afternoon on our side would cost them the day. Metered APIs do
   * not bill a 500. The trade is that a genuine failure can be retried for
   * free, so one counted session may cost us two calls — the right way round,
   * because the cost of our failure lands on us.
   *
   * A parse failure counts as a failure. A reply we cannot use is not a
   * session the student had.
   */
  async evaluateTranscript(
    studentId: string | undefined,
    teilNumber: number,
    transcript: string,
  ): Promise<SpeakingEvaluationResponseDto> {
    // A token naming nobody has nobody to charge, which is the same choice
    // StudentSubscriptionGuard makes for the same reason. Refusing here would
    // be a decision about authentication taken in the wrong place.
    if (studentId) {
      await this.quota.assertWithinQuota(studentId, 'SPEAKING_EVALUATION');
    }

    const prompt = this.buildPrompt(teilNumber, transcript);
    const raw = await this.callWithTimeout(prompt);
    const evaluation = this.parseResponse(raw);

    if (studentId) {
      // `recordDelivered`, not `record`: the student already has their result,
      // so a failure to write the meter must not take it away.
      //
      // Caught here as well, deliberately. recordDelivered swallows its own
      // failures, but the guarantee that matters — an evaluation, once
      // produced, is always returned — should not depend on a future edit
      // keeping that method rather than swapping in `record`. The error is
      // already logged inside; this only stops it reaching the student.
      await this.usage
        .recordDelivered(studentId, 'SPEAKING_EVALUATION')
        .catch(() => undefined);
    }

    return evaluation;
  }

  private buildPrompt(teilNumber: number, transcript: string): string {
    const context = this.getTeilContext(teilNumber);

    return `You are an expert German language examiner evaluating a telc B1 speaking exam (Teil ${teilNumber}).

**TEIL ${teilNumber} CONTEXT:**
${context}

**STUDENT TRANSCRIPT:**
${transcript}

**EVALUATION TASK:**
Analyze the student's performance and provide scores for:
1. Grammar (0-100): Grammatical accuracy and sentence structure
2. Vocabulary (0-100): Range and appropriateness of vocabulary
3. Coherence (0-100): Logical flow, topic relevance, and clarity of expression
4. Overall (0-100): Weighted average reflecting B1 proficiency

Also provide:
- evaluation_text: A warm, natural German paragraph (3-5 sentences) starting with "Hallo!" that a teacher would SPEAK ALOUD to the student. Mention the overall score, highlight one strength, and mention one specific correction. Write it as flowing speech — NO markdown, NO bullet points, NO headers.
- corrections: Up to 10 most important errors. error_type must be "grammar" or "vocabulary" only.
- strengths: One or two sentences in German about what the student did well.
- areas_for_improvement: One or two sentences in German about what to focus on.

**SCORING CRITERIA (B1 Level):**
- 90-100: Excellent — exceeds B1
- 75-89: Good — solid B1
- 60-74: Satisfactory — meets B1 minimum
- 50-59: Needs improvement
- 0-49: Insufficient

**OUTPUT FORMAT (valid JSON only, no markdown code blocks):**
{
  "grammar_score": 75,
  "vocabulary_score": 72,
  "coherence_score": 80,
  "overall_score": 76,
  "evaluation_text": "Hallo! Hier sind die Ergebnisse deiner Sprechübung für Teil ${teilNumber}. Insgesamt hast du 76 von 100 Punkten erreicht. Dein Wortschatz ist sehr gut und du drückst dich klar aus. Achte noch auf die Verbkonjugation — du hast zum Beispiel gesagt: ich gehen ins Kino — richtig wäre: ich gehe ins Kino. Weiter so, du machst gute Fortschritte!",
  "strengths": "Der Student verwendet einen abwechslungsreichen Wortschatz und drückt sich klar aus.",
  "areas_for_improvement": "Die Verbkonjugation und der Satzbau sollten noch verbessert werden.",
  "corrections": [
    {
      "original": "Ich gehen oft ins Kino",
      "corrected": "Ich gehe oft ins Kino",
      "explanation": "Das Verb 'gehen' muss in der ersten Person Singular konjugiert werden: 'ich gehe'.",
      "error_type": "grammar"
    }
  ]
}`;
  }

  private getTeilContext(teilNumber: number): string {
    const contexts: Record<number, string> = {
      1: 'Personal introduction and background. The student should talk about themselves, hobbies, work, and daily life.',
      2: 'Opinion and experience on a given topic. The student should express opinions, give examples, and elaborate.',
      3: 'Debate and argumentation. The student should take a position, defend it with arguments, and show reasoning.',
    };
    return contexts[teilNumber] ?? contexts[1];
  }

  private async callWithTimeout(prompt: string): Promise<string> {
    let timeoutId: NodeJS.Timeout;

    const evaluationPromise = this.geminiService
      .generateTextResponse(prompt)
      .catch((err) => {
        this.logger.error(`Gemini call failed: ${err.message}`);
        throw new Error('GEMINI_EVALUATION_FAILED');
      });

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error('EVALUATION_TIMEOUT')),
        this.EVALUATION_TIMEOUT_MS,
      );
    });

    try {
      const result = await Promise.race([evaluationPromise, timeoutPromise]);
      clearTimeout(timeoutId!);
      return result;
    } catch (error) {
      clearTimeout(timeoutId!);
      if ((error as Error).message === 'EVALUATION_TIMEOUT') {
        this.logger.warn('Evaluation timed out after 30 seconds');
      }
      throw error;
    }
  }

  private parseResponse(response: string): SpeakingEvaluationResponseDto {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('NO_JSON_IN_RESPONSE');

      const p = JSON.parse(jsonMatch[0]);

      const validateScore = (v: unknown, field: string) => {
        if (typeof v !== 'number' || v < 0 || v > 100)
          throw new Error(`Invalid score for ${field}: ${v}`);
      };

      validateScore(p.grammar_score, 'grammar');
      validateScore(p.vocabulary_score, 'vocabulary');
      validateScore(p.coherence_score, 'coherence');
      validateScore(p.overall_score, 'overall');

      if (typeof p.evaluation_text !== 'string' || !p.evaluation_text.trim())
        throw new Error('Missing evaluation_text');

      const corrections: CorrectionDto[] = (
        Array.isArray(p.corrections) ? p.corrections : []
      )
        .slice(0, 10)
        .filter(
          (c: Record<string, unknown>) =>
            c.original && c.corrected && c.explanation && c.error_type,
        )
        .map((c: Record<string, unknown>) => ({
          original: String(c.original),
          corrected: String(c.corrected),
          explanation: String(c.explanation),
          error_type: c.error_type === 'vocabulary' ? 'vocabulary' : 'grammar',
        }));

      const scores: ScoresDto = {
        grammar: p.grammar_score,
        vocabulary: p.vocabulary_score,
        coherence: p.coherence_score,
        overall: p.overall_score,
      };

      return {
        evaluationText: p.evaluation_text,
        scores,
        corrections,
        strengths: p.strengths ?? '',
        areas_for_improvement: p.areas_for_improvement ?? '',
      };
    } catch (error) {
      this.logger.error(
        `Failed to parse evaluation response: ${(error as Error).message}`,
      );
      this.logger.debug(`Raw response: ${response}`);
      throw new Error('EVALUATION_PARSE_FAILED');
    }
  }
}
