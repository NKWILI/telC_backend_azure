import {
  IsString,
  IsInt,
  Min,
  Max,
  IsObject,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitSprachbausteineDto {
  @ApiProperty()
  @IsString()
  id!: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  modelltestNumber!: number;

  @ApiProperty()
  @IsString()
  teil_id!: string;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @IsInt()
  @Min(0)
  @Max(100)
  score_percent!: number;

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

export class SubmitSprachbausteineResponseDto {
  @ApiProperty()
  score!: number;
}
