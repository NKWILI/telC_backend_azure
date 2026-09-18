import type { SharedHistoryFields } from '../../student-activity/student-history';

/**
 * DTO for one item in GET /api/speaking/sessions response (student's history).
 */
export interface SessionHistoryItemDto extends Omit<
  SharedHistoryFields,
  'completedAt'
> {
  sessionId: string;
  teilNumber: number;
  completedAt: string; // ISO date
  overallScore: number | null;
  strengths: string | null;
  areasForImprovement: string | null;
}
