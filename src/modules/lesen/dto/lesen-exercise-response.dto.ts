import { ApiProperty } from '@nestjs/swagger';
import { LesenTeil1Dto } from './lesen-teil1.dto';
import { LesenTeil2Dto } from './lesen-teil2.dto';
import { LesenTeil3Dto } from './lesen-teil3.dto';

export class LesenExerciseResponseDto {
  @ApiProperty()
  contentRevision!: string;

  @ApiProperty()
  issuedAt!: string;

  @ApiProperty({ type: () => LesenTeil1Dto })
  teil1!: LesenTeil1Dto;

  @ApiProperty({ type: () => LesenTeil2Dto })
  teil2!: LesenTeil2Dto;

  @ApiProperty({ type: () => LesenTeil3Dto })
  teil3!: LesenTeil3Dto;
}
