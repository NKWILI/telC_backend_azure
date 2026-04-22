import { IsString, IsInt, Min, Max, IsObject, IsOptional } from 'class-validator';

export class SubmitSprachbausteineDto {
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

export interface SubmitSprachbausteineResponseDto {
  score: number;
}
