import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../shared/services/database.service';
import { WritingGateway, CorrectionReadyPayload } from './writing.gateway';
import { GeminiService } from '../speaking/services/gemini.service';

export interface CorrectionJobData {
  attemptId: string;
  studentId: string;
  exerciseId: string;
  content: string;
  createdAt: string;
}

const STUB_SCORE = 75;
const STUB_FEEDBACK = 'Stub feedback. Echte Korrektur folgt.';
const GEMINI_TIMEOUT_MS = 28000;

const ALLOWED_ERROR_TYPES = ['grammar', 'vocabulary', 'spelling', 'style'];

export interface ParsedWritingCorrection {
  score: number;
  feedback: string;
  corrections: Array<{
    original: string;
    corrected: string;
    explanation: string;
    error_type: string;
  }>;
}

@Injectable()
export class WritingCorrectionService {
  private readonly logger = new Logger(WritingCorrectionService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly gateway: WritingGateway,
    private readonly geminiService: GeminiService,
  ) {}

  /**
   * Run correction via Gemini; on timeout/API/parse error fall back to stub.
   * Updates writing_attempts and emits correction_ready. Does not throw.
   */
  async runCorrection(data: CorrectionJobData): Promise<void> {
    const { attemptId, studentId, exerciseId, content, createdAt } = data;
    const completedAt = new Date().toISOString();
    const created = new Date(createdAt).getTime();
    const durationSeconds = Math.round((Date.now() - created) / 1000);

    let parsed: ParsedWritingCorrection | null = null;
    try {
      const prompt = this.buildWritingPrompt(content);
      const responseText = await this.callGeminiWithTimeout(prompt);
      parsed = this.parseWritingResponse(responseText);
    } catch (err) {
      this.logger.warn(
        `Gemini correction failed for attempt ${attemptId}, using stub: ${(err as Error).message}`,
      );
    }

    const score = parsed?.score ?? STUB_SCORE;
    const feedback = parsed?.feedback ?? STUB_FEEDBACK;
    const correctionsForDb = parsed?.corrections ?? [];
    const correctionsForPayload: CorrectionReadyPayload['corrections'] =
      correctionsForDb.map((c) => ({
        original: c.original,
        corrected: c.corrected,
        explanation: c.explanation,
        errorType: c.error_type,
      }));

    try {
      const updatePayload: Record<string, unknown> = {
        status: 'completed',
        score,
        feedback,
        duration_seconds: durationSeconds,
        completed_at: completedAt,
      };
      if (correctionsForDb.length > 0) {
        updatePayload.corrections = correctionsForDb;
      }

      const { error: updateError } = await this.db
        .getClient()
        .from('writing_attempts')
        .update(updatePayload)
        .eq('attempt_id', attemptId);

      if (updateError) {
        this.logger.error(
          `Failed to update writing attempt ${attemptId}: ${updateError.message}`,
        );
        return;
      }

      const payload: CorrectionReadyPayload = {
        attemptId,
        exerciseId,
        status: 'completed',
        score,
        feedback,
        durationSeconds,
        corrections: correctionsForPayload,
      };

      this.gateway.notifyCorrectionReady(studentId, payload);
    } catch (err) {
      this.logger.error(
        `Correction failed for attempt ${attemptId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  private buildWritingPrompt(content: string): string {
    return `You are an expert German B1 writing corrector for telc Schreiben tasks.
Evaluate the following student text. Provide a single JSON object (no markdown, no extra text) with:
- "score" (number 0-100): overall writing quality at B1 level
- "feedback" (string): short feedback in German, suitable for B1 learners
- "corrections" (array, max 10 items): most important errors. Each item: "original", "corrected", "explanation" (in German), "error_type" (one of: grammar, vocabulary, spelling, style)

**STUDENT TEXT:**
${content}

**SCORING (B1):** 90-100 excellent, 75-89 good, 60-74 satisfactory, 50-59 needs improvement, 0-49 insufficient.

**OUTPUT (JSON only):**
{
  "score": 78,
  "feedback": "Ihre E-Mail hat eine klare Struktur. Achten Sie auf die Konjugation der Verben.",
  "corrections": [
    {
      "original": "Ich habe geschrieben",
      "corrected": "Ich schreibe",
      "explanation": "Für eine formelle E-Mail eignet sich das Präsens besser.",
      "error_type": "grammar"
    }
  ]
}`;
  }

  private async callGeminiWithTimeout(prompt: string): Promise<string> {
    let timeoutId: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('WRITING_CORRECTION_TIMEOUT'));
      }, GEMINI_TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([
        this.geminiService.generateTextResponse(prompt),
        timeoutPromise,
      ]);
      clearTimeout(timeoutId!);
      return result;
    } catch (error) {
      clearTimeout(timeoutId!);
      throw error;
    }
  }

  private parseWritingResponse(response: string): ParsedWritingCorrection {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('NO_JSON_FOUND_IN_RESPONSE');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const score = parsed.score;
    if (typeof score !== 'number' || score < 0 || score > 100) {
      throw new Error(`Invalid score: ${score}`);
    }

    const feedback = typeof parsed.feedback === 'string' ? parsed.feedback : '';
    if (!Array.isArray(parsed.corrections)) {
      throw new Error('Corrections must be an array');
    }

    const corrections = parsed.corrections
      .slice(0, 10)
      .map((c: Record<string, unknown>, index: number) => {
        if (
          typeof c.original !== 'string' ||
          typeof c.corrected !== 'string' ||
          typeof c.explanation !== 'string' ||
          typeof c.error_type !== 'string'
        ) {
          throw new Error(`Invalid correction at index ${index}`);
        }
        if (!ALLOWED_ERROR_TYPES.includes(c.error_type)) {
          throw new Error(
            `Invalid error_type at index ${index}: ${c.error_type}`,
          );
        }
        return {
          original: c.original,
          corrected: c.corrected,
          explanation: c.explanation,
          error_type: c.error_type,
        };
      });

    return { score, feedback, corrections };
  }
}
