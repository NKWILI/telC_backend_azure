import type { LesenTeil2OptionDto } from './lesen-teil2-option.dto';

export interface LesenTeil2QuestionDto {
  id: string;
  content: string;
  options: LesenTeil2OptionDto[];
  correctOptionId: string;
}
