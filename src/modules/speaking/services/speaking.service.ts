import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../shared/services/prisma.service';
import type { TeilListItemDto, SessionHistoryItemDto } from '../dto';

@Injectable()
export class SpeakingService {
  private readonly logger = new Logger(SpeakingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /api/speaking/teils
   * Returns the list of 3 Teils with metadata for the catalog screen.
   */
  getTeils(): TeilListItemDto[] {
    return [
      {
        id: 1,
        part: 1,
        title: 'Lire à voix haute',
        subtitle: 'Lisez la phrase affichée à voix haute.',
        topicTitle: 'Aufgabe: Stellen Sie sich vor',
        topicDescription:
          'Sprechen Sie über sich. Gehen Sie auf die folgenden Punkte ein. Bilden Sie vollständige Sätze.',
        topicPoints: ['Name', 'Alter', 'Land & Wohnort', 'Sprachen', 'Beruf', 'Hobby'],
        durationMinutes: 10,
        prepDurationSeconds: 300,
        imagePath: 'assets/images/modules/sprechen.jpg',
        examImagePath: null,
        instructions:
          'In this Teil, you will introduce yourself. Talk about your name, where you are from, your hobbies, and your work or studies. Speak naturally and clearly.',
      },
      {
        id: 2,
        part: 2,
        title: 'Dialogue',
        subtitle: 'Pratiquez des échanges courts en situation.',
        topicTitle: 'Aufgabe: Bildbeschreibung',
        topicDescription:
          'Beschreiben Sie das Bild genau. Was sehen Sie? Wie ist die Situation?',
        topicPoints: [
          'Was sehen Sie auf dem Foto?',
          'Was machen die Personen?',
          'Wie ist die Umgebung/Wetter?',
          'Ihre persönliche Meinung zum Thema.',
        ],
        durationMinutes: 15,
        prepDurationSeconds: 300,
        imagePath: 'assets/images/modules/sprechen.jpg',
        examImagePath: 'assets/images/modules/sprechen.jpg',
        instructions:
          'In this Teil, you will describe a picture and express your opinion on the topic shown. Give concrete examples and elaborate your thoughts.',
      },
      {
        id: 3,
        part: 3,
        title: 'Répétition',
        subtitle: "Répétez la phrase après l'écoute.",
        topicTitle: 'Aufgabe: Ein Abschiedsfest planen',
        topicDescription:
          'Ihr Kollege Patrick verlässt die Firma. Sie möchten mit Ihrer Partnerin eine Überraschungsparty organisieren.',
        topicPoints: [
          'Wann feiern?',
          'Wo feiern?',
          'Essen und Trinken?',
          'Geschenk für Patrick?',
          'Wer wird eingeladen?',
        ],
        durationMinutes: 5,
        prepDurationSeconds: 300,
        imagePath: 'assets/images/modules/sprechen.jpg',
        examImagePath: null,
        instructions:
          'In this Teil, you will discuss a task with a partner. Take a position, suggest ideas, and reach an agreement together.',
      },
    ];
  }

  /**
   * GET /api/speaking/sessions
   * Returns past completed sessions for the student (read-only history).
   */
  async getSessions(
    studentId: string,
    teilNumber?: number,
    limit = 50,
  ): Promise<SessionHistoryItemDto[]> {
    try {
      const rows = await this.prisma.examSession.findMany({
        where: {
          student_id: studentId,
          status: { in: ['completed', 'interrupted'] },
          completed_at: { not: null },
          ...(teilNumber !== undefined && teilNumber >= 1 && teilNumber <= 3
            ? { teil_number: teilNumber }
            : {}),
        },
        include: {
          teil_evaluations: {
            select: {
              overall_score: true,
              strengths: true,
              areas_for_improvement: true,
            },
          },
        },
        orderBy: { completed_at: 'desc' },
        take: limit,
      });

      return rows.map((row) => {
        const evalRow = row.teil_evaluations[0];
        return {
          sessionId: row.session_id,
          teilNumber: row.teil_number,
          completedAt: (row.completed_at as Date)?.toISOString() ?? '',
          overallScore: evalRow?.overall_score ?? null,
          strengths: evalRow?.strengths ?? null,
          areasForImprovement: evalRow?.areas_for_improvement ?? null,
        };
      });
    } catch (err) {
      this.logger.error(`Error in getSessions: ${(err as Error).message}`);
      return [];
    }
  }
}
