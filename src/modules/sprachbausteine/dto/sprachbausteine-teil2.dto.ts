import type { SprachbausteineWordBankItemDto } from './sprachbausteine-word-bank-item.dto';
import type { SprachbausteineTeil2GapDto } from './sprachbausteine-teil2-gap.dto';

export interface SprachbausteineTeil2Dto {
  label: string;
  instruction: string;
  durationMinutes: number;
  body: string;
  wordBank: SprachbausteineWordBankItemDto[];
  gaps: SprachbausteineTeil2GapDto[];
}
