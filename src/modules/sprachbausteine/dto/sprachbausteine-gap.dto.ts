import { ApiProperty } from '@nestjs/swagger';
import { SprachbausteineOptionDto } from './sprachbausteine-option.dto';

export class SprachbausteineGapDto {
  @ApiProperty()
  id!: string;

  /**
   * The correct option for this gap, in the same encoding the client submits
   * and POST /submit returns, so a correction screen compares directly.
   *
   * Shipped with the exercise by decision, reversing 7678440 — see
   * docs/adr/0001-answer-key-with-exercise.md for why, and what it costs.
   */
  @ApiProperty({
    example: '21b',
    description:
      'Correct option id for this gap. Same encoding as options[].id and as ' +
      'the answers submitted to POST /submit.',
  })
  correctOptionId!: string;

  @ApiProperty({ type: () => SprachbausteineOptionDto, isArray: true })
  options!: SprachbausteineOptionDto[];
}
