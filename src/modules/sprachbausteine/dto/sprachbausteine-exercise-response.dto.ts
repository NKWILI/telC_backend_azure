import type { SprachbausteineGapDto } from './sprachbausteine-gap.dto';
import type { SprachbausteineTeil2Dto } from './sprachbausteine-teil2.dto';

export interface SprachbausteineExerciseResponseDto {
  contentRevision: string;
  issuedAt: string;
  teil1: SprachbausteineTeilDto;
  teil2: SprachbausteineTeil2Dto;
}

export interface SprachbausteineTeilDto {
  label: string;
  instruction: string;
  durationMinutes: number;
  body: string;
  gaps: SprachbausteineGapDto[];
}
