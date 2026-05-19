/**
 * One item in GET /api/writing/sessions response.
 * Frontend parses with ExerciseAttempt.fromJson (camelCase).
 */
export interface ExerciseAttemptDto {
  id: string;
  date?: string;
  dateLabel?: string;
  score?: number;
  feedback?: string;
  durationSeconds?: number;
  originalText?: string;
  correctedText?: string;
  diff?: Array<{ op: 'equal' | 'delete' | 'insert'; text: string }>;
  pointsAddressed?: number;
  corrections?: Array<{
    original: string;
    corrected: string;
    explanation?: string;
    errorType?: string;
  }>;
}
