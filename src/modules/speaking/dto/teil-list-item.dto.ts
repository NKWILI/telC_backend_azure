/**
 * DTO for one Teil in GET /api/speaking/teils response.
 * Frontend maps to SpeakingExerciseType (id as string, part, durationMinutes, imagePath, etc.).
 */
export interface TeilListItemDto {
  id: number; // 1 | 2 | 3
  part: number;
  title: string;
  subtitle: string;
  topicTitle: string;
  topicDescription: string;
  topicPoints: string[];
  durationMinutes: number;
  prepDurationSeconds: number;
  imagePath: string;
  examImagePath: string | null;
  instructions?: string;
}
