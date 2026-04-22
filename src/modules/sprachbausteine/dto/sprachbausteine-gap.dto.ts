import type { SprachbausteineOptionDto } from './sprachbausteine-option.dto';

export interface SprachbausteineGapDto {
  id: string;
  options: SprachbausteineOptionDto[];
  correctOptionId: string;
}
