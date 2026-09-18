import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Min,
  Max,
  MinLength,
} from 'class-validator';
import { ClientAttemptId } from '../../student-activity/attempt-id.decorator';

export class EvaluateSpeakingDto {
  @ApiProperty({ example: 1, enum: [1, 2, 3] })
  @IsInt()
  @Min(1)
  @Max(3)
  teilNumber: number;

  @ApiProperty({
    example:
      'Ich heiße Alain. Ich komme aus Kamerun und lerne seit zwei Jahren Deutsch.',
    minLength: 10,
  })
  @IsString()
  @MinLength(10)
  transcript: string;

  @ApiPropertyOptional({
    example: 1,
    default: 1,
    description:
      'The Modelltest whose Teil was spoken. Defaults to 1, like every other route.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  modelltestNumber?: number;

  @ClientAttemptId()
  attemptId?: string;

  @ApiPropertyOptional({ example: 180, description: 'Time spent, in seconds.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  durationSeconds?: number;
}
