import { IsBoolean, IsNotEmpty, IsObject, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubmitListeningDto {
  @ApiProperty({
    description: 'Teil id — must match the type used in GET /exercise',
    example: '1',
    enum: ['1', '2', '3'],
  })
  @IsNotEmpty({ message: 'type is required' })
  @IsString()
  type: string;

  @ApiProperty({
    description: 'true = exam mode (no answer reveal), false = practice mode',
    example: false,
  })
  @IsBoolean()
  timed: boolean;

  @ApiProperty({
    description: 'Must match the content_revision returned by GET /exercise',
    example: 'modelltest-1-teil-1-v1',
  })
  @IsNotEmpty({ message: 'content_revision is required' })
  @IsString()
  content_revision: string;

  @ApiProperty({
    description: 'Map of question id → "+" (richtig) or "−" (falsch). At least one entry required.',
    example: { q41: '+', q42: '+', q43: '-', q44: '+', q45: '-' },
    additionalProperties: { type: 'string', enum: ['+', '-'] },
  })
  @IsObject({ message: 'answers must be an object' })
  answers: Record<string, string>;
}
