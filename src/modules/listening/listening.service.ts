import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '../../shared/services/database.service';
import type { ExerciseTypeDto } from '../writing/dto/exercise-type.dto';
import type { ExerciseAttemptDto } from '../writing/dto/exercise-attempt.dto';
import type { ListeningExerciseDto } from './dto/listening-exercise.dto';
import type { SubmitListeningDto } from './dto/submit-listening.dto';
import type { SubmitListeningResponseDto } from './dto/submit-listening-response.dto';

// ---------------------------------------------------------------------------
// Static catalog
// ---------------------------------------------------------------------------

interface CatalogEntry {
  teil: Omit<ExerciseTypeDto, 'progress'>;
  exercise: Omit<ListeningExerciseDto, 'issued_at'>;
  answerKey: Record<string, string>;
}

const CATALOG: Record<string, CatalogEntry> = {
  '1': {
    teil: {
      id: '1',
      title: 'Teil 1',
      subtitle: 'Globales Hören',
      prompt: 'Sie hören einen kurzen Text. Wählen Sie die richtige Antwort.',
      imagePath: '',
      part: 1,
      durationMinutes: 10,
    },
    exercise: {
      content_revision: 'mock-horen-teil-1-v1',
      audio_url: 'https://telc-speaking-api-bvftfmarf9e8cwfb.germanywestcentral-01.azurewebsites.net/static/audio/h%C3%B6renmuster.mpeg',
      bundled_audio_asset: '',
      questions: [
        {
          id: 'q11',
          prompt: 'Wo findet das Gespräch statt?',
          options: [
            { id: 'a', label: 'Im Supermarkt' },
            { id: 'b', label: 'Im Bahnhof' },
            { id: 'c', label: 'In der Schule' },
          ],
        },
        {
          id: 'q12',
          prompt: 'Was möchte die Frau kaufen?',
          options: [
            { id: 'a', label: 'Einen Fahrschein' },
            { id: 'b', label: 'Ein Buch' },
            { id: 'c', label: 'Lebensmittel' },
          ],
        },
        {
          id: 'q13',
          prompt: 'Wann fährt der nächste Zug?',
          options: [
            { id: 'a', label: 'Um 10:15 Uhr' },
            { id: 'b', label: 'Um 11:00 Uhr' },
            { id: 'c', label: 'Um 10:45 Uhr' },
          ],
        },
        {
          id: 'q14',
          prompt: 'Wie viel kostet die Fahrkarte?',
          options: [
            { id: 'a', label: '12,50 Euro' },
            { id: 'b', label: '8,00 Euro' },
            { id: 'c', label: '15,00 Euro' },
          ],
        },
        {
          id: 'q15',
          prompt: 'Wohin fährt der Mann?',
          options: [
            { id: 'a', label: 'Nach Berlin' },
            { id: 'b', label: 'Nach München' },
            { id: 'c', label: 'Nach Hamburg' },
          ],
        },
      ],
    },
    answerKey: { q11: 'b', q12: 'a', q13: 'c', q14: 'b', q15: 'a' },
  },
  '2': {
    teil: {
      id: '2',
      title: 'Teil 2',
      subtitle: 'Detailliertes Hören',
      prompt: 'Sie hören ein Gespräch. Beantworten Sie die Fragen.',
      imagePath: '',
      part: 2,
      durationMinutes: 10,
    },
    exercise: {
      content_revision: 'mock-horen-teil-2-v1',
      audio_url: 'https://telc-speaking-api-bvftfmarf9e8cwfb.germanywestcentral-01.azurewebsites.net/static/audio/h%C3%B6renmuster.mpeg',
      bundled_audio_asset: '',
      questions: [
        {
          id: 'q21',
          prompt: 'Was ist das Thema des Gesprächs?',
          options: [
            { id: 'a', label: 'Urlaub planen' },
            { id: 'b', label: 'Eine Wohnung suchen' },
            { id: 'c', label: 'Einen Arzttermin vereinbaren' },
          ],
        },
        {
          id: 'q22',
          prompt: 'Wie groß soll die Wohnung sein?',
          options: [
            { id: 'a', label: '40 Quadratmeter' },
            { id: 'b', label: '60 Quadratmeter' },
            { id: 'c', label: '80 Quadratmeter' },
          ],
        },
        {
          id: 'q23',
          prompt: 'In welchem Stadtteil soll die Wohnung liegen?',
          options: [
            { id: 'a', label: 'In der Stadtmitte' },
            { id: 'b', label: 'Am Stadtrand' },
            { id: 'c', label: 'Im Norden' },
          ],
        },
        {
          id: 'q24',
          prompt: 'Wie hoch ist das monatliche Budget?',
          options: [
            { id: 'a', label: '500 Euro' },
            { id: 'b', label: '700 Euro' },
            { id: 'c', label: '900 Euro' },
          ],
        },
        {
          id: 'q25',
          prompt: 'Wann möchten sie einziehen?',
          options: [
            { id: 'a', label: 'Sofort' },
            { id: 'b', label: 'In einem Monat' },
            { id: 'c', label: 'In drei Monaten' },
          ],
        },
      ],
    },
    answerKey: { q21: 'b', q22: 'c', q23: 'a', q24: 'b', q25: 'c' },
  },
  '3': {
    teil: {
      id: '3',
      title: 'Teil 3',
      subtitle: 'Selektives Hören',
      prompt:
        'Sie hören Durchsagen. Notieren Sie die wichtigsten Informationen.',
      imagePath: '',
      part: 3,
      durationMinutes: 10,
    },
    exercise: {
      content_revision: 'mock-horen-teil-3-v1',
      audio_url: 'https://telc-speaking-api-bvftfmarf9e8cwfb.germanywestcentral-01.azurewebsites.net/static/audio/h%C3%B6renmuster.mpeg',
      bundled_audio_asset: '',
      questions: [
        {
          id: 'q31',
          prompt: 'Welche Information wird zuerst genannt?',
          options: [
            { id: 'a', label: 'Abfahrtszeit' },
            { id: 'b', label: 'Gleisnummer' },
            { id: 'c', label: 'Zugverspätung' },
          ],
        },
        {
          id: 'q32',
          prompt: 'Wie lange ist die Verspätung?',
          options: [
            { id: 'a', label: '5 Minuten' },
            { id: 'b', label: '15 Minuten' },
            { id: 'c', label: '30 Minuten' },
          ],
        },
        {
          id: 'q33',
          prompt: 'Welches Gleis wird genannt?',
          options: [
            { id: 'a', label: 'Gleis 3' },
            { id: 'b', label: 'Gleis 7' },
            { id: 'c', label: 'Gleis 12' },
          ],
        },
        {
          id: 'q34',
          prompt: 'Wohin fährt der Zug?',
          options: [
            { id: 'a', label: 'Frankfurt' },
            { id: 'b', label: 'Köln' },
            { id: 'c', label: 'Stuttgart' },
          ],
        },
        {
          id: 'q35',
          prompt: 'Was sollen die Fahrgäste tun?',
          options: [
            { id: 'a', label: 'Den nächsten Zug nehmen' },
            { id: 'b', label: 'Am Gleis warten' },
            { id: 'c', label: 'Am Informationsschalter anfragen' },
          ],
        },
      ],
    },
    answerKey: { q31: 'c', q32: 'b', q33: 'a', q34: 'b', q35: 'b' },
  },
};

const TEIL_IDS = Object.keys(CATALOG);

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class ListeningService {
  private readonly logger = new Logger(ListeningService.name);

  constructor(private readonly db: DatabaseService) {}

  async getTeils(studentId: string): Promise<ExerciseTypeDto[]> {
    const progress = await this.getProgressByExercise(studentId);
    return TEIL_IDS.map((id) => ({
      ...CATALOG[id].teil,
      progress: progress[id] ?? 0,
    }));
  }

  async getSessions(
    studentId: string,
    teilNumber?: number,
    limit = 50,
  ): Promise<ExerciseAttemptDto[]> {
    try {
      let query = this.db
        .getClient()
        .from('listening_attempts')
        .select(
          'attempt_id, created_at, completed_at, score, feedback, duration_seconds',
        )
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (teilNumber !== undefined) {
        const exerciseId = String(teilNumber);
        if (TEIL_IDS.includes(exerciseId)) {
          query = query.eq('exercise_id', exerciseId);
        }
      }

      const { data: rows, error } = await query;

      if (error) {
        this.logger.error(
          `Failed to fetch listening sessions: ${error.message}`,
        );
        return [];
      }

      return (rows || []).map((row: Record<string, unknown>) =>
        this.mapRowToAttemptDto(
          row as Parameters<typeof this.mapRowToAttemptDto>[0],
        ),
      );
    } catch (err) {
      this.logger.error(`Error in getSessions: ${(err as Error).message}`);
      return [];
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getExercise(type: string): Promise<ListeningExerciseDto> {
    const entry = CATALOG[type];
    if (!entry) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'Not Found',
        message: 'Exercise type not found',
        messageKey: 'listeningExerciseNotFound',
      });
    }
    return { ...entry.exercise, issued_at: new Date().toISOString() };
  }

  async submit(
    studentId: string,
    dto: SubmitListeningDto,
  ): Promise<SubmitListeningResponseDto> {
    const entry = CATALOG[dto.type];
    if (!entry) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Unknown exercise type',
        messageKey: 'listeningUnknownType',
      });
    }

    if (dto.content_revision !== entry.exercise.content_revision) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Content revision mismatch — please reload the exercise',
        messageKey: 'listeningStaleRevision',
      });
    }

    if (!dto.answers || Object.keys(dto.answers).length === 0) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Answers must not be empty',
        messageKey: 'listeningEmptyAnswers',
      });
    }

    const score = this.computeScore(dto.answers, entry.answerKey);

    try {
      const { error } = await this.db
        .getClient()
        .from('listening_attempts')
        .insert({
          student_id: studentId,
          exercise_id: dto.type,
          status: 'completed',
          score,
          timed: dto.timed,
          content_revision: dto.content_revision,
          completed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        });

      if (error) {
        this.logger.error(
          `Failed to persist listening attempt: ${error.message}`,
        );
      }
    } catch (err) {
      this.logger.error(`DB error on submit: ${(err as Error).message}`);
    }

    return { score };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private computeScore(
    answers: Record<string, string>,
    answerKey: Record<string, string>,
  ): number {
    const total = Object.keys(answerKey).length;
    if (total === 0) return 0;
    let correct = 0;
    for (const [qId, correctOpt] of Object.entries(answerKey)) {
      if (answers[qId] === correctOpt) correct++;
    }
    return Math.round((correct / total) * 100);
  }

  private async getProgressByExercise(
    studentId: string,
  ): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const id of TEIL_IDS) result[id] = 0;

    try {
      const { data: rows, error } = await this.db
        .getClient()
        .from('listening_attempts')
        .select('exercise_id')
        .eq('student_id', studentId)
        .eq('status', 'completed');

      if (error || !rows) return result;

      for (const row of rows as { exercise_id: string }[]) {
        if (TEIL_IDS.includes(row.exercise_id)) {
          result[row.exercise_id] = 100;
        }
      }
    } catch {
      // ignore — return zeroed progress
    }
    return result;
  }

  private mapRowToAttemptDto(row: {
    attempt_id: string;
    created_at?: string;
    completed_at?: string | null;
    score?: number | null;
    feedback?: string | null;
    duration_seconds?: number | null;
  }): ExerciseAttemptDto {
    const date = row.completed_at || row.created_at || '';
    return {
      id: row.attempt_id,
      date: date || undefined,
      dateLabel: date ? this.formatDateLabel(date) : undefined,
      score: row.score ?? undefined,
      feedback: row.feedback ?? undefined,
      durationSeconds: row.duration_seconds ?? undefined,
    };
  }

  private formatDateLabel(isoDate: string): string {
    const d = new Date(isoDate);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (dateOnly.getTime() === today.getTime()) return 'Heute';
    if (dateOnly.getTime() === yesterday.getTime()) return 'Gestern';
    return d.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }
}
