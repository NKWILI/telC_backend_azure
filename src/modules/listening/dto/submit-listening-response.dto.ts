import { ApiProperty } from '@nestjs/swagger';

export class SubmitListeningResponseDto {
  @ApiProperty({ description: 'Server-computed percentage score', example: 80 })
  score: number;

  @ApiProperty({
    description:
      'Correct answer per question. "+" = richtig, "−" = falsch. ' +
      'Frontend computes per-question verdicts by comparing submitted answers against this key.',
    example: { q41: '-', q42: '+', q43: '-', q44: '+', q45: '+' },
    additionalProperties: { type: 'string', enum: ['+', '-'] },
  })
  answerKey: Record<string, string>;
}
