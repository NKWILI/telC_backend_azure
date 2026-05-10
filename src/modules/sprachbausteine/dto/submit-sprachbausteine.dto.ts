import { IsInt, Min, IsObject, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubmitSprachbausteineDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  modelltestNumber!: number;

  @ApiProperty({ enum: ['1', '2'] })
  @IsIn(['1', '2'])
  teil_id!: '1' | '2';

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
