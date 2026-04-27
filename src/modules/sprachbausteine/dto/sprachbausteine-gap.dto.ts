import { ApiProperty } from '@nestjs/swagger';
import { SprachbausteineOptionDto } from './sprachbausteine-option.dto';

export class SprachbausteineGapDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: () => SprachbausteineOptionDto, isArray: true })
  options!: SprachbausteineOptionDto[];

  @ApiProperty()
  correctOptionId!: string;
}
