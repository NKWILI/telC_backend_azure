import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VerifyEmailRequestDto {
  @ApiProperty({ description: 'One-time token from the verification email.' })
  @IsNotEmpty({ message: 'Token is required' })
  @IsString({ message: 'Token must be a string' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  token: string;

  @ApiProperty({
    description: 'Stable identifier for this browser or app installation.',
  })
  @IsNotEmpty({ message: 'Device ID is required' })
  @IsString({ message: 'Device ID must be a string' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  deviceId: string;

  @ApiPropertyOptional({ example: 'Chrome on Windows' })
  @IsOptional()
  @IsString({ message: 'Device name must be a string' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  deviceName?: string;
}
