import type { LesenTeil1Dto } from './lesen-teil1.dto';
import type { LesenTeil2Dto } from './lesen-teil2.dto';

export interface LesenExerciseResponseDto {
  contentRevision: string;
  issuedAt: string;
  teil1: LesenTeil1Dto;
  teil2: LesenTeil2Dto;
}
