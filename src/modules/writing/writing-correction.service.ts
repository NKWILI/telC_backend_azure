import { Inject, Injectable, Logger } from '@nestjs/common';
import { diffWords } from 'diff';
import { PrismaService } from '../../shared/services/prisma.service';
import {
  WritingGateway,
  CorrectionReadyPayload,
  DiffOp,
} from './writing.gateway';
import { WRITING_EXERCISES } from './writing-exercises.const';
import { MODEL_SERVICE_TOKEN } from './services/model-service.interface';
import type { ModelService } from './services/model-service.interface';
import type { WritingExerciseDto } from './dto';

export interface CorrectionJobData {
  attemptId: string;
  studentId: string;
  exerciseId: string;
  content: string;
  createdAt: string;
}

const STUB_SCORE = 75;
const STUB_FEEDBACK = 'Stub feedback. Echte Korrektur folgt.';
const STUB_CORRECTED_TEXT = '';
const STUB_DIFF: DiffOp[] = [];
const MODEL_TIMEOUT_MS = 28000;

const ALLOWED_ERROR_TYPES = ['grammar', 'vocabulary', 'spelling', 'style'];

export interface ParsedWritingCorrection {
  score: number;
  feedback: string;
  correctedText: string;
  pointsAddressed?: number;
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
    private readonly prisma: PrismaService,
    private readonly gateway: WritingGateway,
    @Inject(MODEL_SERVICE_TOKEN) private readonly modelService: ModelService,
  ) {}

  /**
   * Run correction via the configured model; on timeout/API/parse error fall back to stub.
   * Updates writing_attempts and emits correction_ready. Does not throw.
   */
  async runCorrection(data: CorrectionJobData): Promise<void> {
    const { attemptId, studentId, exerciseId, content, createdAt } = data;
    const completedAt = new Date().toISOString();
    const created = new Date(createdAt).getTime();
    const durationSeconds = Math.round((Date.now() - created) / 1000);

    const exercise: WritingExerciseDto | null =
      WRITING_EXERCISES[exerciseId] ?? null;

    let parsed: ParsedWritingCorrection | null = null;
    try {
      const prompt = this.buildWritingPrompt(content, exercise);
      const responseText = await this.callModelWithTimeout(prompt);
      parsed = this.parseWritingResponse(responseText);
    } catch (err) {
      this.logger.warn(
        `Model correction failed for attempt ${attemptId}, using stub: ${(err as Error).message}`,
      );
    }

    const score = parsed?.score ?? STUB_SCORE;
    const feedback = parsed?.feedback ?? STUB_FEEDBACK;
    const correctedText = parsed?.correctedText ?? STUB_CORRECTED_TEXT;
    const pointsAddressed = parsed?.pointsAddressed;
    const diff: DiffOp[] = correctedText
      ? diffWords(content, correctedText).map((part) => ({
          op: part.added ? 'insert' : part.removed ? 'delete' : 'equal',
          text: part.value,
        }))
      : STUB_DIFF;
    const correctionsForDb = parsed?.corrections ?? [];
    const correctionsForPayload: CorrectionReadyPayload['corrections'] =
      correctionsForDb.map((c) => ({
        original: c.original,
        corrected: c.corrected,
        explanation: c.explanation,
        errorType: c.error_type,
      }));

    try {
      await this.prisma.writingAttempt.update({
        where: { attempt_id: attemptId },
        data: {
          status: 'completed',
          score,
          feedback,
          corrected_text: correctedText,
          diff,
          points_addressed: pointsAddressed ?? null,
          duration_seconds: durationSeconds,
          completed_at: new Date(completedAt),
          ...(correctionsForDb.length > 0
            ? { corrections: correctionsForDb }
            : {}),
        },
      });

      const payload: CorrectionReadyPayload = {
        attemptId,
        exerciseId,
        status: 'completed',
        score,
        feedback,
        originalText: content,
        correctedText,
        diff,
        pointsAddressed,
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

  private buildWritingPrompt(
    content: string,
    exercise: WritingExerciseDto | null,
  ): string {
    const exerciseBlock = exercise
      ? this.formatExerciseForPrompt(exercise)
      : '';
    const pointsCount = exercise?.bulletPoints?.length ?? 0;
    const pointsAddressedSchema = pointsCount > 0
      ? `\n- "points_addressed" (integer 0-${pointsCount}): how many of the ${pointsCount} required bullet points the student addressed in their text`
      : '';
    const pointsAddressedExample = pointsCount > 0
      ? `\n  "points_addressed": 3,`
      : '';

    return `You are an expert German B1 writing corrector for telc Schreiben tasks.
Evaluate the following student text against the exercise brief. Provide a single JSON object (no markdown, no extra text) with:
- "score" (number 0-100): overall writing quality at B1 level
- "feedback" (string): short feedback in German, suitable for B1 learners. If the student missed any required bullet points, mention which ones.
- "corrected_text" (string): the student's full text rewritten with all corrections applied. Keep tone and structure; fix grammar, spelling, vocabulary, and style.
- "corrections" (array, max 10 items): most important errors. Each item: "original", "corrected", "explanation" (in German), "error_type" (one of: grammar, vocabulary, spelling, style)${pointsAddressedSchema}
${exerciseBlock}
**STUDENT TEXT:**
${content}

**SCORING (B1):** 90-100 excellent, 75-89 good, 60-74 satisfactory, 50-59 needs improvement, 0-49 insufficient. ${pointsCount > 0 ? `If the student missed required bullet points, lower the score proportionally.` : ''}

**OUTPUT (JSON only):**
{
  "score": 78,
  "feedback": "Ihre E-Mail hat eine klare Struktur. Achten Sie auf die Konjugation der Verben.",${pointsAddressedExample}
  "corrected_text": "Sehr geehrte Frau Müller,\\nich schreibe Ihnen bezüglich Ihres Angebots vom 12. Mai...",
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

  private formatExerciseForPrompt(exercise: WritingExerciseDto): string {
    const parts: string[] = ['**EXERCISE BRIEF:**'];
    if (exercise.intro) parts.push(exercise.intro);
    if (exercise.stimulus) {
      const s = exercise.stimulus;
      parts.push(`\n${s.heading}`);
      if (s.body) parts.push(s.body);
      if (s.features?.length) {
        parts.push('Merkmale:');
        for (const f of s.features) parts.push(`- ${f}`);
      }
      if (s.callToAction) parts.push(s.callToAction);
      if (s.contact) {
        parts.push(`${s.contact.name}`);
        for (const line of s.contact.lines) parts.push(line);
      }
    }
    parts.push(`\n${exercise.taskInstructions}`);
    if (exercise.bulletPoints?.length) {
      parts.push('Required points the student MUST address:');
      exercise.bulletPoints.forEach((bp, i) =>
        parts.push(`${i + 1}. ${bp}`),
      );
    }
    if (exercise.closingReminder) parts.push(`\n${exercise.closingReminder}`);
    return parts.join('\n') + '\n';
  }

  private async callModelWithTimeout(prompt: string): Promise<string> {
    let timeoutId: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('WRITING_CORRECTION_TIMEOUT'));
      }, MODEL_TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([
        this.modelService.generateTextResponse(prompt),
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

    const correctedText: string =
      typeof parsed.corrected_text === 'string' ? parsed.corrected_text : '';
    if (!correctedText) {
      this.logger.warn(
        'AI response missing corrected_text — keeping score/feedback/corrections, no rewrite available',
      );
    }

    let pointsAddressed: number | undefined;
    if (
      typeof parsed.points_addressed === 'number' &&
      Number.isInteger(parsed.points_addressed) &&
      parsed.points_addressed >= 0
    ) {
      pointsAddressed = parsed.points_addressed;
    }

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

    return { score, feedback, correctedText, pointsAddressed, corrections };
  }
}
