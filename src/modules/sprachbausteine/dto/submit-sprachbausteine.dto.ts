import { IsInt, Min, IsIn, Max, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitSprachbausteineDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  modelltestNumber!: number;

  @ApiProperty({ enum: ['1', '2'] })
  @IsIn(['1', '2'])
  teil_id!: '1' | '2';

  @ApiProperty({ example: 73, minimum: 0, maximum: 100 })
  @IsInt()
  @Min(0)
  @Max(100)
  score!: number;

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
