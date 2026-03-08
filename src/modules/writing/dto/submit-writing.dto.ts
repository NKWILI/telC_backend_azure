import { IsNotEmpty, IsString, MinLength } from 'class-validator';

/**
 * Request body for POST /api/writing/submit.
 * Frontend sends exerciseId (same as id from teils) and raw text content.
 */
export class SubmitWritingDto {
  @IsNotEmpty({ message: 'exerciseId is required' })
  @IsString()
  exerciseId: string;

  @IsNotEmpty({ message: 'content is required' })
  @IsString()
  @MinLength(1, { message: 'content must not be empty' })
  content: string;
}
