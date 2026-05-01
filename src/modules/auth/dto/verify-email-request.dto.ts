import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class VerifyEmailRequestDto {
  @IsNotEmpty({ message: 'Token is required' })
  @IsString({ message: 'Token must be a string' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  token: string;

  @IsNotEmpty({ message: 'Device ID is required' })
  @IsString({ message: 'Device ID must be a string' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  deviceId: string;

  @IsOptional()
  @IsString({ message: 'Device name must be a string' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  deviceName?: string;
}