import type { SprachbausteineOptionDto } from './sprachbausteine-option.dto';

export interface SprachbausteineGapDto {
  id: string;
  gapKey: string;
  options: SprachbausteineOptionDto[];
  correctOptionId: string;
}
