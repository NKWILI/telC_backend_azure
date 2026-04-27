import { ApiProperty } from '@nestjs/swagger';
import { SprachbausteineGapDto } from './sprachbausteine-gap.dto';
import { SprachbausteineTeil2Dto } from './sprachbausteine-teil2.dto';

export class SprachbausteineTeilDto {
  @ApiProperty()
  label!: string;

  @ApiProperty()
  instruction!: string;

  @ApiProperty()
  durationMinutes!: number;

  @ApiProperty()
  body!: string;

  @ApiProperty({ type: () => SprachbausteineGapDto, isArray: true })
  gaps!: SprachbausteineGapDto[];
}

export class SprachbausteineExerciseResponseDto {
  @ApiProperty()
  contentRevision!: string;

  @ApiProperty()
  issuedAt!: string;

  @ApiProperty({ type: () => SprachbausteineTeilDto })
  teil1!: SprachbausteineTeilDto;

  @ApiProperty({ type: () => SprachbausteineTeil2Dto })
  teil2!: SprachbausteineTeil2Dto;
}
