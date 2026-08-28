import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LiveTokenTopicDto {
  @ApiProperty({ example: 'Arbeit und Freizeit' })
  title: string;

  @ApiProperty({ example: 'Sprechen Sie über Ihre Arbeit und Ihre Freizeit.' })
  description: string;

  @ApiProperty({ type: [String], example: ['Ihr Arbeitstag', 'Ihre Hobbys'] })
  points: string[];
}

export class LiveTokenResponseDto {
  @ApiProperty({
    example: 'auth_tokens/abc123',
    description:
      'Ephemeral, single-use Gemini token. Locked to the live model, audio ' +
      'modality and the Teil instruction. Not the API key.',
  })
  token: string;

  @ApiProperty({ example: 'gemini-3.1-flash-live-preview' })
  model: string;

  @ApiProperty({
    example: 600,
    description:
      'Hard session ceiling. Google rejects messages past it, so the session ' +
      'cannot outlive this value regardless of client behaviour.',
  })
  expiresInSeconds: number;

  @ApiProperty({ example: 2, enum: [1, 2, 3] })
  teilNumber: number;

  @ApiPropertyOptional({
    type: LiveTokenTopicDto,
    description:
      'The topic Elena was told to discuss, echoed back so the client can ' +
      'show it. Absent when the Modelltest has no seeded speaking exercise.',
  })
  topic?: LiveTokenTopicDto;
}
