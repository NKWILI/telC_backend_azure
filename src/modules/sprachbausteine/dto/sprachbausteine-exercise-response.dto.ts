import type { SprachbausteineGapDto } from './sprachbausteine-gap.dto';

export interface SprachbausteineExerciseResponseDto {
  contentRevision: string;
  issuedAt: string;
  teil1: SprachbausteineTeilDto;
}

export interface SprachbausteineTeilDto {
  label: string;
  instruction: string;
  durationMinutes: number;
  body: string;
  gaps: SprachbausteineGapDto[];
}
