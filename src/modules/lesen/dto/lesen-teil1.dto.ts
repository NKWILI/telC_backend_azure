import type { LesenTeil1TextDto } from './lesen-teil1-text.dto';
import type { LesenTeil1TitleDto } from './lesen-teil1-title.dto';

export interface LesenTeil1Dto {
  label: string;
  instruction: string;
  texts: LesenTeil1TextDto[];
  titles: LesenTeil1TitleDto[];
  correctMatches: Record<string, string>;
}
