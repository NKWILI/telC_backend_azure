import { ApiProperty } from '@nestjs/swagger';
import { LesenTeil2OptionDto } from './lesen-teil2-option.dto';

export class LesenTeil2QuestionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  content!: string;

  @ApiProperty({ type: () => LesenTeil2OptionDto, isArray: true })
  options!: LesenTeil2OptionDto[];

  @ApiProperty()
  correctOptionId!: string;
}
