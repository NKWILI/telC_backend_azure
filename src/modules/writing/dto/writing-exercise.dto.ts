/**
 * Full content of a single telc Schreiben exercise.
 * Returned by GET /api/writing/exercise/:id so the frontend can render the
 * exam screen (stimulus + task instructions + bullet points).
 *
 * Plain structured text — frontend handles rendering and timing.
 */

export interface WritingExerciseContact {
  name: string;
  lines: string[];
}

export interface WritingExerciseStimulus {
  heading: string;
  body?: string;
  features?: string[];
  callToAction?: string;
  contact?: WritingExerciseContact;
}

export interface WritingExerciseDto {
  id: string;
  part: number;
  title: string;
  subtitle?: string;
  taskType: 'brief' | 'forumsbeitrag';
  intro?: string;
  stimulus?: WritingExerciseStimulus;
  taskInstructions: string;
  bulletPoints: string[];
  closingReminder?: string;
}
