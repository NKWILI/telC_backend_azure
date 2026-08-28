import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * The client asks for a Teil and nothing else.
 *
 * It deliberately cannot send prompt text, topic text or a model name: the
 * system instruction is assembled server-side and sealed into the ephemeral
 * token, so no client-supplied string ever reaches Elena's instructions.
 */
export class CreateLiveTokenDto {
  @ApiProperty({ example: 2, enum: [1, 2, 3] })
  @IsInt()
  @Min(1)
  @Max(3)
  teilNumber: number;

  @ApiPropertyOptional({
    example: 1,
    description: 'Modelltest to take the topic from. Defaults to 1.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  modelltest?: number;
}
