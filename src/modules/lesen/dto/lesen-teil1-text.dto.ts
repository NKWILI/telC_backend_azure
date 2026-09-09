import { ApiProperty } from '@nestjs/swagger';

export class LesenTeil1TextDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true })
  von!: string | null;

  @ApiProperty({ nullable: true })
  an!: string | null;

  @ApiProperty()
  body!: string;

  /**
   * The titles[].id that belongs to this text — the same value POST /submit
   * accepts as this text's answer. See docs/adr/0001-answer-key-with-exercise.md.
   */
  @ApiProperty({
    description:
      'Correct titles[].id for this text. Same encoding as the answers ' +
      'submitted to POST /submit.',
  })
  correctTitleId!: string;
}
