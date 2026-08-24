import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import {
  SpeakingEvaluationResponseDto,
  CorrectionDto,
  ScoresDto,
} from '../dto/evaluation-response.dto';

@Injectable()
export class EvaluationService {
  private readonly logger = new Logger(EvaluationService.name);
  private readonly EVALUATION_TIMEOUT_MS = 30000;

  constructor(private readonly geminiService: GeminiService) {}

  async evaluateTranscript(
    teilNumber: number,
    transcript: string,
  ): Promise<SpeakingEvaluationResponseDto> {
    const prompt = this.buildPrompt(teilNumber, transcript);
    const raw = await this.callWithTimeout(prompt);
    return this.parseResponse(raw);
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
