import { ApiProperty } from '@nestjs/swagger';
import { LesenTeil1TextDto } from './lesen-teil1-text.dto';
import { LesenTeil1TitleDto } from './lesen-teil1-title.dto';

export class LesenTeil1Dto {
  @ApiProperty()
  label!: string;

  @ApiProperty()
  instruction!: string;

  @ApiProperty({ type: () => LesenTeil1TextDto, isArray: true })
  texts!: LesenTeil1TextDto[];

  @ApiProperty({ type: () => LesenTeil1TitleDto, isArray: true })
  titles!: LesenTeil1TitleDto[];

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  correctMatches!: Record<string, string>;
}
