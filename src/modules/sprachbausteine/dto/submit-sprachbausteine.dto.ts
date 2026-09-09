import {
  IsInt,
  Min,
  IsIn,
  Max,
  IsOptional,
  IsObject,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitSprachbausteineDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  modelltestNumber!: number;

  @ApiProperty({ enum: ['1', '2'] })
  @IsIn(['1', '2'])
  teil_id!: '1' | '2';

  @ApiPropertyOptional({
    example: 73,
    minimum: 0,
    maximum: 100,
    deprecated: true,
    description: 'Ignored; score is calculated by the backend',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  score?: number;

  @ApiProperty({ additionalProperties: { type: 'string' } })
  @IsObject()
  answers!: Record<string, string>;

  @ApiProperty()
  @IsString()
  contentRevision!: string;

  @ApiPropertyOptional({ example: 540 })
  @IsOptional()
  @IsInt()
  @Min(0)
  durationSeconds?: number;
}

export class SubmitSprachbausteineResponseDto {
  @ApiProperty()
  score!: number;

  /**
   * The correct answer per gap, in the same encoding the client submits, so a
   * correction screen can compare the two directly:
   *   Teil 1 → { "21": "21b" }   gap key + option letter
   *   Teil 2 → { "31": "wa"  }   word-bank id
   *
   * Released here rather than from GET /exercise on purpose. Shipping it with
   * the exercise would put the answers in the browser before the student has
   * answered — the exposure closed in 7678440 and guarded by a test. Returning
   * it once the attempt is recorded gives the frontend what it needs to show
   * corrections, and gives up nothing: the answers are only revealed after the
   * submission they grade.
   */
  @ApiProperty({
    description:
      'Correct answer per gap, keyed by gap id, in the same encoding as the ' +
      'submitted answers. Compare client-side to mark each gap right or wrong.',
    example: { '21': '21b', '22': '22a' },
    additionalProperties: { type: 'string' },
  })
  answerKey!: Record<string, string>;
}
