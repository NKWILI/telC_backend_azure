import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DiffOpDto {
  @ApiProperty({ enum: ['equal', 'delete', 'insert'] })
  op: 'equal' | 'delete' | 'insert';

  @ApiProperty()
  text: string;
}

export class InlineCorrectionDto {
  @ApiProperty({ description: 'Original (incorrect) text fragment' })
  original: string;

  @ApiProperty({ description: 'Corrected text fragment' })
  corrected: string;

  @ApiPropertyOptional({ description: 'Explanation in German' })
  explanation?: string;

  @ApiPropertyOptional({ enum: ['grammar', 'vocabulary', 'spelling', 'style'] })
  errorType?: string;
}

export class ExerciseAttemptDto {
  @ApiProperty({ description: 'Attempt UUID' })
  id: string;

  @ApiPropertyOptional({ description: 'ISO 8601 completion or creation timestamp' })
  date?: string;

  @ApiPropertyOptional({ description: 'Human-readable date label (Heute / Gestern / dd.mm.yyyy)' })
  dateLabel?: string;

  @ApiPropertyOptional({ description: 'Overall score 0–100', minimum: 0, maximum: 100 })
  score?: number;

  @ApiPropertyOptional({ description: 'AI feedback in German' })
  feedback?: string;

  @ApiPropertyOptional({ description: 'Time spent writing in seconds' })
  durationSeconds?: number;

  @ApiPropertyOptional({ description: "The student's original submitted text" })
  originalText?: string;

  @ApiPropertyOptional({ description: 'AI-rewritten corrected version of the text' })
  correctedText?: string;

  @ApiPropertyOptional({
    description: 'Word-level diff between originalText and correctedText',
    type: [DiffOpDto],
  })
  diff?: DiffOpDto[];

  @ApiPropertyOptional({
    description: 'Number of required bullet points the student addressed (0–5)',
    minimum: 0,
    maximum: 5,
  })
  pointsAddressed?: number;

  @ApiPropertyOptional({
    description: 'List of inline corrections (max 10)',
    type: [InlineCorrectionDto],
  })
  corrections?: InlineCorrectionDto[];
}
