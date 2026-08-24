import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubmitWritingDto {
  @ApiProperty({
    description:
      'UUID of the writing exercise (from GET /api/modelltests/:number → exercises.writing)',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsNotEmpty({ message: 'exerciseId is required' })
  @IsString()
  exerciseId: string;

  @ApiProperty({
    description: "The student's written text",
    example: 'Sehr geehrte Damen und Herren, ich schreibe Ihnen bezüglich...',
    minLength: 1,
  })
  @IsNotEmpty({ message: 'content is required' })
  @IsString()
  @MinLength(1, { message: 'content must not be empty' })
  content: string;
}
