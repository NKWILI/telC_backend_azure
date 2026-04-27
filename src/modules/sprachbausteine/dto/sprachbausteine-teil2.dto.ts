import { ApiProperty } from '@nestjs/swagger';
import { SprachbausteineWordBankItemDto } from './sprachbausteine-word-bank-item.dto';
import { SprachbausteineTeil2GapDto } from './sprachbausteine-teil2-gap.dto';

export class SprachbausteineTeil2Dto {
  @ApiProperty()
  label!: string;

  @ApiProperty()
  instruction!: string;

  @ApiProperty()
  durationMinutes!: number;

  @ApiProperty()
  body!: string;

  @ApiProperty({ type: () => SprachbausteineWordBankItemDto, isArray: true })
  wordBank!: SprachbausteineWordBankItemDto[];

  @ApiProperty({ type: () => SprachbausteineTeil2GapDto, isArray: true })
  gaps!: SprachbausteineTeil2GapDto[];
}
