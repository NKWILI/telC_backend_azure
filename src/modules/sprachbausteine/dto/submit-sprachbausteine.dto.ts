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
}
