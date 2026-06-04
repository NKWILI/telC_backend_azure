import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import type { ExerciseTypeDto } from '../writing/dto/exercise-type.dto';
import type { ExerciseAttemptDto } from '../writing/dto/exercise-attempt.dto';
import type { ListeningExerciseDto } from './dto/listening-exercise.dto';
import type { SubmitListeningDto } from './dto/submit-listening.dto';
import type { SubmitListeningResponseDto } from './dto/submit-listening-response.dto';

// ---------------------------------------------------------------------------
// Static catalog — Modelltest 1
// ---------------------------------------------------------------------------

interface CatalogEntry {
  teil: Omit<ExerciseTypeDto, 'progress'>;
  exercise: Omit<ListeningExerciseDto, 'issued_at'>;
  answerKey: Record<string, string>;
}

const TEIL_IMAGE_URLS: Record<string, string> = {
  '1': 'https://pub-9c97adaccfb94d4bb515056232bed4f8.r2.dev/hoerverstehen_teil1.png',
  '2': 'https://pub-9c97adaccfb94d4bb515056232bed4f8.r2.dev/hoerverstehen_teil2.png',
  '3': 'https://pub-9c97adaccfb94d4bb515056232bed4f8.r2.dev/hoerverstehen_teil3.png',
};

const CATALOG: Record<string, CatalogEntry> = {
  '1': {
    teil: {
      id: '1',
      title: 'Teil 1',
      subtitle: 'Hörverstehen, Teil 1',
      prompt:
        'Sie hören die Aussagen von fünf Personen. Sie hören die Aussagen nur einmal. Entscheiden Sie beim Hören, ob die Aussagen 41–45 richtig (+) oder falsch (–) sind.',
      imagePath: TEIL_IMAGE_URLS['1'],
      part: 1,
      durationMinutes: 10,
    },
    exercise: {
      content_revision: 'modelltest-1-teil-1-v1',
      audio_url: '',
      bundled_audio_asset: '',
      imagePath: TEIL_IMAGE_URLS['1'],
      questions: [
        {
          id: 'q41',
          prompt:
            'Für Manfred Rienke ist das Fortbildungsangebot wichtig.',
        },
        {
          id: 'q42',
          prompt: 'Alena Groll bildet sich regelmäßig weiter.',
        },
        {
          id: 'q43',
          prompt:
            'Weng Wang stellt vor dem Seminar viele Fragen an die Seminarleitung.',
        },
        {
          id: 'q44',
          prompt:
            'Maria Vallomäinen erklärt, wie Fortbildungsveranstaltungen entstehen.',
        },
        {
          id: 'q45',
          prompt:
            'Manus Mani lehnt Fortbildungen ab, weil dann seine eigene Arbeit liegen bleibt.',
        },
      ],
    },
    answerKey: { q41: '-', q42: '+', q43: '-', q44: '+', q45: '+' },
  },

  '2': {
    teil: {
      id: '2',
      title: 'Teil 2',
      subtitle: 'Hörverstehen, Teil 2',
      prompt:
        'Sie hören ein Gespräch. Sie hören das Gespräch zweimal. Entscheiden Sie beim Hören, ob die Aussagen 46–55 richtig (+) oder falsch (–) sind.',
      imagePath: TEIL_IMAGE_URLS['2'],
      part: 2,
      durationMinutes: 10,
    },
    exercise: {
      content_revision: 'modelltest-1-teil-2-v1',
      audio_url: '',
      bundled_audio_asset: '',
      imagePath: TEIL_IMAGE_URLS['2'],
      questions: [
        {
          id: 'q46',
          prompt: 'Frau Pauß möchte Herrn Lissitsky kurz sprechen.',
        },
        {
          id: 'q47',
          prompt: 'Herr Lissitsky hat nicht so viel zu tun.',
        },
        {
          id: 'q48',
          prompt:
            'Herr Lissitsky meint, die Quartalszahlen zeigen eine positive Entwicklung.',
        },
        {
          id: 'q49',
          prompt:
            'Frau Pauß spricht über die Lieferung an die ausländische Firma Novis.',
        },
        {
          id: 'q50',
          prompt: 'Der Auftrag war leicht auszuführen.',
        },
        {
          id: 'q51',
          prompt: 'Die Firma Novis beklagt sich nun.',
        },
        {
          id: 'q52',
          prompt: 'Die Firma versteht die Mahnungen nicht.',
        },
        {
          id: 'q53',
          prompt:
            'Herr Lissitsky hat sich um die bezahlten Rechnungen gekümmert.',
        },
        {
          id: 'q54',
          prompt:
            'Frau Pauß bittet Herrn Lissitsky um seine Hilfe bei der Suche nach möglichen Ursachen.',
        },
        {
          id: 'q55',
          prompt: 'Frau Pauß erwartet keine Antwort von Herrn Lissitsky.',
        },
      ],
    },
    answerKey: {
      q46: '+',
      q47: '-',
      q48: '-',
      q49: '+',
      q50: '-',
      q51: '+',
      q52: '+',
      q53: '-',
      q54: '+',
      q55: '-',
    },
  },

  '3': {
    teil: {
      id: '3',
      title: 'Teil 3',
      subtitle: 'Hörverstehen, Teil 3',
      prompt:
        'Sie hören fünf kurze Texte. Sie hören die Texte zweimal. Entscheiden Sie beim Hören, ob die Aussagen 56–60 richtig (+) oder falsch (–) sind.',
      imagePath: TEIL_IMAGE_URLS['3'],
      part: 3,
      durationMinutes: 10,
    },
    exercise: {
      content_revision: 'modelltest-1-teil-3-v1',
      audio_url: '',
      bundled_audio_asset: '',
      imagePath: TEIL_IMAGE_URLS['3'],
      questions: [
        {
          id: 'q56',
          prompt: 'Herr Lehmann würde gern später kommen.',
        },
        {
          id: 'q57',
          prompt: 'Der Chef berücksichtigt die Änderung in der Tagesordnung.',
        },
        {
          id: 'q58',
          prompt:
            'Im Falle einer Notsituation kann Ihnen die Firma Sabel nicht helfen.',
        },
        {
          id: 'q59',
          prompt:
            'Frau Arnold kann Ihnen zu Ihrer Fortbildung Auskunft geben.',
        },
        {
          id: 'q60',
          prompt: 'Sie kommen nicht pünktlich am Zielort an.',
        },
      ],
    },
    answerKey: { q56: '+', q57: '+', q58: '+', q59: '-', q60: '+' },
  },
};

const TEIL_IDS = Object.keys(CATALOG);

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class ListeningService {
  private readonly logger = new Logger(ListeningService.name);

  constructor(private readonly prisma: PrismaService) {}

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
      const exerciseId =
        teilNumber !== undefined && TEIL_IDS.includes(String(teilNumber))
          ? String(teilNumber)
          : undefined;

      const rows = await this.prisma.listeningAttempt.findMany({
        where: {
          student_id: studentId,
          ...(exerciseId ? { exercise_id: exerciseId } : {}),
        },
        orderBy: { created_at: 'desc' },
        take: limit,
        select: {
          attempt_id: true,
          created_at: true,
          completed_at: true,
          score: true,
          feedback: true,
          duration_seconds: true,
        },
      });

      return rows.map((row) => this.mapRowToAttemptDto(row));
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

    // Score computed for DB persistence only — not returned to frontend.
    const score = this.computeScore(dto.answers, entry.answerKey);

    try {
      await this.prisma.listeningAttempt.create({
        data: {
          student_id: studentId,
          exercise_id: dto.type,
          status: 'completed',
          score,
          timed: dto.timed,
          content_revision: dto.content_revision,
          completed_at: new Date(),
        },
      });
    } catch (err) {
      this.logger.error(`DB error on submit: ${(err as Error).message}`);
    }

    return { answerKey: entry.answerKey };
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
      const rows = await this.prisma.listeningAttempt.findMany({
        where: { student_id: studentId, status: 'completed' },
        select: { exercise_id: true },
      });

      for (const row of rows) {
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
    created_at?: Date | string | null;
    completed_at?: Date | string | null;
    score?: number | null;
    feedback?: string | null;
    duration_seconds?: number | null;
  }): ExerciseAttemptDto {
    const toIso = (d: Date | string | null | undefined) =>
      d ? (d instanceof Date ? d.toISOString() : d) : '';
    const date = toIso(row.completed_at) || toIso(row.created_at);
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
