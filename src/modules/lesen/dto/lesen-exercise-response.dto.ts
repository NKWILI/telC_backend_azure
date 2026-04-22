import type { LesenTeil2Dto } from './lesen-teil2.dto';

export interface LesenExerciseResponseDto {
  contentRevision: string;
  issuedAt: string;
  teil2: LesenTeil2Dto;
}
