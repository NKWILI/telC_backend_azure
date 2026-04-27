import { ApiProperty } from '@nestjs/swagger';
import { LesenTeil2QuestionDto } from './lesen-teil2-question.dto';

export class LesenTeil2Dto {
  @ApiProperty()
  label!: string;

  @ApiProperty()
  instruction!: string;

  @ApiProperty()
  cautionNote!: string;

  @ApiProperty()
  sender!: string;

  @ApiProperty()
  receiver!: string;

  @ApiProperty()
  content!: string;

  @ApiProperty()
  quotedThread!: string;

  @ApiProperty({ type: () => LesenTeil2QuestionDto, isArray: true })
  questions!: LesenTeil2QuestionDto[];
}
