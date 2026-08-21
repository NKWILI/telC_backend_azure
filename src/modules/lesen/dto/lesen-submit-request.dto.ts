import {
  IsString,
  IsInt,
  Min,
  Max,
  IsObject,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LesenSubmitRequestDto {
  @ApiPropertyOptional({ default: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  modelltestNumber?: number;

  @ApiProperty()
  @IsString()
  id!: string;

  @ApiProperty()
  @IsString()
  exercise_type_id!: string;

  @ApiProperty()
  @IsString()
  teil_id!: string;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 100,
    deprecated: true,
    description: 'Ignored; score is calculated by the backend',
  })
  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  score_percent?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  remark?: string;

  @ApiProperty()
  @IsString()
  tested_at!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsObject()
  answers!: Record<string, string>;
}

export class LesenSubmitResponseDto {
  @ApiProperty()
  score!: number;
}
