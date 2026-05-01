import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, MinLength, IsString, IsOptional } from 'class-validator';

export class LoginRequestDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @MinLength(8)
  password: string;

  @IsNotEmpty()
  @IsString()
  deviceId: string;

  @IsOptional()
  @IsString()
  deviceName?: string;
}
