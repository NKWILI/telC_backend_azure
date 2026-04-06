/**
 * Shapes for GET /api/listening/exercise response.
 * Frontend parses with ListeningExercisePayload.fromJson (snake_case keys).
 */
export interface ListeningOptionDto {
  id: string;
  label: string;
}

export interface ListeningQuestionDto {
  id: string;
  prompt: string;
  options: ListeningOptionDto[];
}

export interface ListeningExerciseDto {
  content_revision: string;
  issued_at: string;
  audio_url: string;
  bundled_audio_asset?: string;
  questions: ListeningQuestionDto[];
}
