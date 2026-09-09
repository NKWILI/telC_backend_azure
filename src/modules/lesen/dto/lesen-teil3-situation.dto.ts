import { ApiProperty } from '@nestjs/swagger';

export class LesenTeil3SituationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  content!: string;

  /**
   * The announcements[].id (a letter) that answers this situation, or "X" when
   * no announcement fits — telc Teil 3 always has one such situation. Same
   * encoding POST /submit accepts.
   *
   * See docs/adr/0001-answer-key-with-exercise.md.
   */
  @ApiProperty({
    example: 'a',
    description:
      'Correct announcements[].id for this situation, or "X" when none fits.',
  })
  correctAnswer!: string;
}
