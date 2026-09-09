import { ApiProperty } from '@nestjs/swagger';
import { LesenTeil2OptionDto } from './lesen-teil2-option.dto';

export class LesenTeil2QuestionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  content!: string;

  /**
   * The correct options[].id for this question, e.g. "6a". Same encoding
   * POST /submit accepts. See docs/adr/0001-answer-key-with-exercise.md.
   */
  @ApiProperty({
    example: '6a',
    description: 'Correct options[].id for this question.',
  })
  correctOptionId!: string;

  @ApiProperty({ type: () => LesenTeil2OptionDto, isArray: true })
  options!: LesenTeil2OptionDto[];
}
