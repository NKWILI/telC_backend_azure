import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../../shared/services/database.service';
import { GeminiService } from './gemini.service';
import { EvaluationResponseDto } from '../dto/evaluation-response.dto';
import { ConversationMessage } from '../interfaces/session.interface';

/**
 * Service for evaluating speaking exam sessions using Gemini API
 * Provides automatic assessment of pronunciation, fluency, and grammar
 */
@Injectable()
export class EvaluationService {
  private readonly logger = new Logger(EvaluationService.name);
  private readonly EVALUATION_TIMEOUT_MS = 30000; // 30 seconds

  constructor(
    private readonly db: DatabaseService,
    private readonly geminiService: GeminiService,
  ) {}

  /**
   * Evaluate a completed speaking session
   * Returns scores and corrections or throws timeout error
   */
  async evaluateSession(
    sessionId: string,
    studentId: string,
  ): Promise<EvaluationResponseDto> {
    try {
      this.logger.log(`Starting evaluation for session ${sessionId}`);

      // Step 1: Fetch session and transcript from database
      const { data: session, error: sessionError } = await this.db
        .getClient()
        .from('exam_sessions')
        .select('session_id, teil_number, status, student_id')
        .eq('session_id', sessionId)
        .eq('student_id', studentId)
        .single();

      if (sessionError || !session) {
        throw new NotFoundException('SESSION_NOT_FOUND');
      }

      // Verify session is completed
      if (session.status !== 'completed' && session.status !== 'interrupted') {
        throw new Error('SESSION_NOT_COMPLETED');
      }

      // Fetch transcript
      const { data: transcript, error: transcriptError } = await this.db
        .getClient()
        .from('teil_transcripts')
        .select('conversation_history')
        .eq('session_id', sessionId)
        .single();

      if (transcriptError || !transcript) {
        throw new NotFoundException('TRANSCRIPT_NOT_FOUND');
      }

      const conversationHistory: ConversationMessage[] =
        transcript.conversation_history;

      if (!conversationHistory || conversationHistory.length === 0) {
        throw new Error('EMPTY_TRANSCRIPT');
      }

      // Step 2: Generate evaluation prompt
      const evaluationPrompt = this.buildEvaluationPrompt(
        session.teil_number,
        conversationHistory,
      );

      // Step 3: Call Gemini with timeout
      const evaluationResult =
        await this.callGeminiWithTimeout(evaluationPrompt);

      // Step 4: Parse and validate response
      const parsedEvaluation = this.parseEvaluationResponse(evaluationResult);

      // Step 5: Save evaluation to database
      const { error: insertError } = await this.db
        .getClient()
        .from('teil_evaluations')
        .insert({
          session_id: sessionId,
          pronunciation_score: parsedEvaluation.pronunciation_score,
          fluency_score: parsedEvaluation.fluency_score,
          grammar_score: parsedEvaluation.grammar_score,
          vocabulary_score: parsedEvaluation.vocabulary_score,
          overall_score: parsedEvaluation.overall_score,
          corrections_json: parsedEvaluation.corrections,
          strengths: parsedEvaluation.strengths,
          areas_for_improvement: parsedEvaluation.areas_for_improvement,
          evaluation_requested_at: new Date().toISOString(),
        });

      if (insertError) {
        this.logger.error(
          `Failed to save evaluation to database: ${insertError.message}`,
        );
        throw new BadRequestException('EVALUATION_SAVE_FAILED');
      }

      this.logger.log(
        `Evaluation saved to database for session ${sessionId}: Overall score ${parsedEvaluation.overall_score}`,
      );

      return parsedEvaluation;
    } catch (error) {
      this.logger.error(
        `Evaluation failed for session ${sessionId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Build Teil-specific evaluation prompt for Gemini
   */
  private buildEvaluationPrompt(
    teilNumber: number,
    conversationHistory: ConversationMessage[],
  ): string {
    // Format conversation for prompt
    const formattedConversation = conversationHistory
      .map((msg) => {
        const speaker =
          msg.speaker === 'elena' ? 'Elena (Examiner)' : 'Student';
        return `${speaker}: ${msg.text}`;
      })
      .join('\n\n');

    const teilInstructions = this.getTeilContext(teilNumber);

    return `You are an expert German language examiner evaluating a telc B1 speaking exam (Teil ${teilNumber}).

**TEIL ${teilNumber} CONTEXT:**
${teilInstructions}

**CONVERSATION TRANSCRIPT:**
${formattedConversation}

**EVALUATION TASK:**
Analyze the student's performance and provide:
1. **Pronunciation Score** (0-100): Clarity, accent, intonation
2. **Fluency Score** (0-100): Speaking pace, hesitations, natural flow
3. **Grammar Score** (0-100): Grammatical accuracy, sentence structure
4. **Vocabulary Score** (0-100): Range and appropriateness of vocabulary usage
5. **Overall Score** (0-100): Weighted average reflecting B1 proficiency

5. **Top 10 Corrections** (max 10, prioritize most important):
   - Original text (what student said)
   - Corrected version
   - Explanation in German (suitable for B1 learners)
   - Error type: "grammar", "pronunciation", or "vocabulary"

**SCORING CRITERIA (B1 Level):**
- **90-100**: Excellent - Exceeds B1 expectations
- **75-89**: Good - Solid B1 level
- **60-74**: Satisfactory - Meets B1 minimum
- **50-59**: Needs improvement - Below B1
- **0-49**: Insufficient - Well below B1

**OUTPUT FORMAT (JSON only, no markdown):**
{
  "pronunciation_score": 78,
  "fluency_score": 82,
  "grammar_score": 75,
  "vocabulary_score": 72,
  "overall_score": 78,
  "strengths": "Der Schüler spricht fließend und kann seine Meinungen klar ausdrücken...",
  "areas_for_improvement": "Die Verbkonjugation in der dritten Person sollte verbessert werden...",
  "corrections": [
    {
      "original": "Ich gehen oft ins Kino",
      "corrected": "Ich gehe oft ins Kino",
      "explanation": "Das Verb 'gehen' muss in der ersten Person Singular konjugiert werden: 'ich gehe'.",
      "error_type": "grammar"
    }
  ]
}

Provide only valid JSON. Limit corrections to maximum 10 most important errors.
Write strengths and areas_for_improvement in German (suitable for B1 learners).`;
  }

  /**
   * Get Teil-specific context for evaluation
   */
  private getTeilContext(teilNumber: number): string {
    const contexts: Record<number, string> = {
      1: `Personal introduction and background questions. Student should demonstrate ability to talk about themselves, their hobbies, work, and daily life.`,
      2: `Opinion and experience discussion on a given topic. Student should express opinions, provide examples, and elaborate on their thoughts.`,
      3: `Debate and argumentation on a controversial topic. Student should take a position, defend it with arguments, and demonstrate reasoning skills.`,
    };

    return contexts[teilNumber] || contexts[1];
  }

  /**
   * Call Gemini API with 30-second timeout using Promise.race
   */
  private async callGeminiWithTimeout(prompt: string): Promise<string> {
    let timeoutId: NodeJS.Timeout;

    const evaluationPromise = this.runEvaluation(prompt);

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('EVALUATION_TIMEOUT'));
      }, this.EVALUATION_TIMEOUT_MS);
    });

    try {
      const result = await Promise.race([evaluationPromise, timeoutPromise]);
      clearTimeout(timeoutId!);
      return result;
    } catch (error) {
      clearTimeout(timeoutId!);
      if ((error as Error).message === 'EVALUATION_TIMEOUT') {
        this.logger.warn('Evaluation request timed out after 30 seconds');
      }
      throw error;
    }
  }

  /**
   * Create temporary Gemini session for evaluation and get response
   */
  private async runEvaluation(
    prompt: string,
  ): Promise<string> {
    try {
      // Use text-only Gemini API for evaluation (not Live API)
      const responseText =
        await this.geminiService.generateTextResponse(prompt);
      return responseText;
    } catch (error) {
      this.logger.error(`Gemini evaluation call failed: ${error.message}`);
      throw new Error('GEMINI_EVALUATION_FAILED');
    }
  }

  /**
   * Parse Gemini JSON response into EvaluationResponseDto
   */
  private parseEvaluationResponse(response: string): EvaluationResponseDto {
    try {
      // Extract JSON from response (may have markdown code blocks)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('NO_JSON_FOUND_IN_RESPONSE');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate scores are in range 0-100
      const validateScore = (score: number, field: string) => {
        if (typeof score !== 'number' || score < 0 || score > 100) {
          throw new Error(`Invalid ${field}: ${score}`);
        }
      };

      validateScore(parsed.pronunciation_score, 'pronunciation_score');
      validateScore(parsed.fluency_score, 'fluency_score');
      validateScore(parsed.grammar_score, 'grammar_score');
      if (parsed.vocabulary_score !== undefined) {
        validateScore(parsed.vocabulary_score, 'vocabulary_score');
      }
      validateScore(parsed.overall_score, 'overall_score');

      // Validate corrections array
      if (!Array.isArray(parsed.corrections)) {
        throw new Error('Corrections must be an array');
      }

      // Limit to max 10 corrections
      const corrections = parsed.corrections.slice(0, 10);

      // Validate each correction
      corrections.forEach(
        (correction: Record<string, unknown>, index: number) => {
          if (
            !correction.original ||
            !correction.corrected ||
            !correction.explanation ||
            !correction.error_type
          ) {
            throw new Error(`Invalid correction at index ${index}`);
          }

          if (
            !['grammar', 'pronunciation', 'vocabulary'].includes(
              correction.error_type as string,
            )
          ) {
            throw new Error(
              `Invalid error_type at index ${index}: ${correction.error_type}`,
            );
          }
        },
      );

      return {
        pronunciation_score: parsed.pronunciation_score,
        fluency_score: parsed.fluency_score,
        grammar_score: parsed.grammar_score,
        vocabulary_score: parsed.vocabulary_score ?? null,
        overall_score: parsed.overall_score,
        strengths: parsed.strengths || '',
        areas_for_improvement: parsed.areas_for_improvement || '',
        corrections,
      };
    } catch (error) {
      this.logger.error(
        `Failed to parse evaluation response: ${error.message}`,
      );
      this.logger.debug(`Raw response: ${response}`);
      throw new Error('EVALUATION_PARSE_FAILED');
    }
  }
}
