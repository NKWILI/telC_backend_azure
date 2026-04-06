import { IsBoolean, IsNotEmpty, IsObject, IsString } from 'class-validator';

/**
 * Request body for POST /api/listening/submit.
 */
export class SubmitListeningDto {
  @IsNotEmpty({ message: 'type is required' })
  @IsString()
  type: string;

  @IsBoolean()
  timed: boolean;

  @IsNotEmpty({ message: 'content_revision is required' })
  @IsString()
  content_revision: string;

  @IsObject({ message: 'answers must be an object' })
  answers: Record<string, string>;
}
