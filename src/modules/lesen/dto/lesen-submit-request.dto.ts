import { IsString, IsInt, Min, Max, IsObject, IsOptional } from 'class-validator';

export class LesenSubmitRequestDto {
  @IsString()
  id: string;

  @IsString()
  exercise_type_id: string;

  @IsString()
  teil_id: string;

  @IsInt()
  @Min(0)
  @Max(100)
  score_percent: number;

  @IsString()
  @IsOptional()
  remark?: string;

  @IsString()
  tested_at: string;

  @IsObject()
  answers: Record<string, string>;
}

export interface LesenSubmitResponseDto {
  score: number;
}
