import { ApiProperty } from '@nestjs/swagger';

export class SprachbausteineTeil2GapDto {
  @ApiProperty()
  id!: string;

  /**
   * The word-bank id that belongs in this gap ("wa"), not the database uuid the
   * column of the same name holds. Same encoding as wordBank[].id and as the
   * answers submitted to POST /submit.
   *
   * See docs/adr/0001-answer-key-with-exercise.md.
   */
  @ApiProperty({
    example: 'wa',
    description: 'Correct wordBank id for this gap.',
  })
  correctWordId!: string;
}
