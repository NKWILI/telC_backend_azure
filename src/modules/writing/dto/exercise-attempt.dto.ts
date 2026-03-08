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
}
