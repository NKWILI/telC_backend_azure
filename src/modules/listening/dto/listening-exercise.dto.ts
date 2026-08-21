import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ListeningQuestionDto {
  @ApiProperty({ example: 'q41' })
  id: string;

  @ApiProperty({
    example: 'Für Manfred Rienke ist das Fortbildungsangebot wichtig.',
  })
  prompt: string;
}

export class ListeningExerciseDto {
  @ApiProperty({
    description: 'Content version string — send back unchanged in submit',
    example: 'modelltest-1-teil-1-v1',
  })
  content_revision: string;

  @ApiProperty({
    description: 'ISO 8601 timestamp of when this response was generated',
    example: '2026-06-04T09:00:00.000Z',
  })
  issued_at: string;

  @ApiProperty({
    description:
      'HTTPS URL of the audio file. Empty string means use bundled asset.',
    example: '',
  })
  audio_url: string;

  @ApiPropertyOptional({
    description: 'Path relative to Flutter assets/ folder',
    example: '',
  })
  bundled_audio_asset?: string;

  @ApiProperty({
    description: 'Image URL for this Teil (Cloudflare R2)',
    example:
      'https://pub-9c97adaccfb94d4bb515056232bed4f8.r2.dev/hoerverstehen_teil1.png',
  })
  imagePath: string;

  @ApiProperty({
    description:
      'Richtig(+)/falsch(−) statements. No options array — student answers each with "+" or "−".',
    type: [ListeningQuestionDto],
  })
  questions: ListeningQuestionDto[];
}
