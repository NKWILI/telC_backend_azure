import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitWritingResponseDto {
  @ApiProperty({
    description: 'UUID of the newly created writing attempt',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  attemptId: string;

  @ApiProperty({
    description: 'Always "pending" — correction is processed asynchronously',
    example: 'pending',
  })
  status: string;

  @ApiPropertyOptional({
    description: 'Human-readable confirmation message',
    example: 'Submission received. Correction in progress.',
  })
  message?: string;
}
