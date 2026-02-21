import {
  IsNumber,
  IsString,
  IsArray,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CorrectionDto {
  @IsString()
  original: string; // Original text spoken by student

  @IsString()
  corrected: string; // Corrected version

  @IsString()
  explanation: string; // Explanation in German suitable for B1 learners

  @IsString()
  error_type: 'grammar' | 'pronunciation' | 'vocabulary';
}

export class EvaluationResponseDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  pronunciation_score: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  fluency_score: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  grammar_score: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  vocabulary_score: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  overall_score: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CorrectionDto)
  corrections: CorrectionDto[]; // Top 10 most important corrections

  @IsString()
  strengths: string; // Positive feedback in German

  @IsString()
  areas_for_improvement: string; // Areas to improve in German
}
