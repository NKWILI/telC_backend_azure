/**
 * One item in GET /api/writing/teils response.
 * Frontend parses with ExerciseType.fromJson (camelCase).
 */
export interface ExerciseTypeDto {
  id: string;
  title: string;
  subtitle?: string;
  prompt?: string;
  imagePath?: string;
  progress?: number;
  part?: number;
  durationMinutes?: number;
  /** Shared by every module (D29), from the student's recorded activity. */
  attempts?: number;
  bestScore?: number | null;
  lastScore?: number | null;
  lastAttemptAt?: string | null;
  maxScore?: number;
}
