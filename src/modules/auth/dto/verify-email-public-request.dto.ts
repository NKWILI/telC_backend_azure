import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyEmailPublicRequestDto {
  @IsNotEmpty({ message: 'Token is required' })
  @IsString({ message: 'Token must be a string' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  token: string;
}
