import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyEmailPublicRequestDto {
  @ApiProperty({ description: 'One-time token from the verification email.' })
  @IsNotEmpty({ message: 'Token is required' })
  @IsString({ message: 'Token must be a string' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  token: string;
}
