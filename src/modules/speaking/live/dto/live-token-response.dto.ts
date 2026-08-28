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
    example: 'f2c1a0e4-9b3d-4c7a-8e1f-0a2b3c4d5e6f',
    description:
      'Identifies this session to POST /api/speaking/live-session/end. Send it ' +
      'when the conversation finishes so the slot is freed immediately; ' +
      'otherwise it is held for the full session ceiling and blocks others. ' +
      'Treat it as a secret — it is the only thing needed to free the slot.',
  })
  sessionId: string;

  @ApiProperty({
    example: 'auth_tokens/abc123',
    description:
      'Ephemeral, single-use Gemini token. Locked to the live model, audio ' +
      'modality and the Teil instruction. Not the API key. The client MUST ' +
      'connect with apiVersion "v1alpha" — ephemeral token support does not ' +
      'exist on v1beta, and the socket opens and then closes without a setup ' +
      'if you use it. Connect within 60 seconds; the token works exactly once.',
  })
  token: string;

  @ApiProperty({
    example: 'gemini-3.1-flash-live-preview',
    description: 'Pass verbatim to live.connect — do not hardcode client-side.',
  })
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
