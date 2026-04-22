import type { LesenTeil2ThreadDto } from './lesen-teil2-thread.dto';
import type { LesenTeil2QuestionDto } from './lesen-teil2-question.dto';

export interface LesenTeil2Dto {
  label: string;
  instruction: string;
  cautionNote: string;
  thread: LesenTeil2ThreadDto;
  questions: LesenTeil2QuestionDto[];
}
