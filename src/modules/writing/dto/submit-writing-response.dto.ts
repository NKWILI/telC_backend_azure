import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitWritingResponseDto {
  @ApiProperty({
    description:
      'UUID of the writing attempt: the id the app sent, or a new one when it sent none',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  attemptId: string;

  @ApiProperty({
    description:
      '"pending" for a new submission — correction is processed asynchronously. A repeat of an attempt already received answers with the current status of that attempt.',
    example: 'pending',
  })
  status: string;

  @ApiPropertyOptional({
    description: 'Human-readable confirmation message',
    example: 'Submission received. Correction in progress.',
  })
  message?: string;
}
