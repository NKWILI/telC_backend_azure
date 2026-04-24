import type { LesenTeil2QuestionDto } from './lesen-teil2-question.dto';

export interface LesenTeil2Dto {
  label: string;
  instruction: string;
  cautionNote: string;
  sender: string;
  receiver: string;
  content: string;
  quotedThread: string;
  questions: LesenTeil2QuestionDto[];
}
