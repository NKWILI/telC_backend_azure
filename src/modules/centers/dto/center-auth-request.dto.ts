import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MaxUtf8Bytes,
  NormalizeEmail,
  Trim,
} from './center-validation.decorators';

export class VerifyCenterEmailDto {
  @ApiProperty({
    description: 'One-time token from the center verification email.',
    maxLength: 256,
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token: string;

  @ApiProperty({
    description: 'Stable identifier for this browser or app installation.',
    maxLength: 255,
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  deviceId: string;

  @ApiPropertyOptional({ example: 'Chrome on Windows', maxLength: 255 })
  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceName?: string;
}

export class CenterLoginDto {
  @ApiProperty({
    format: 'email',
    example: 'manager@example.com',
    maxLength: 254,
  })
  @NormalizeEmail()
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  @IsEmail()
  email: string;

  @ApiProperty({
    minLength: 8,
    format: 'password',
    description: 'Maximum 72 UTF-8 bytes.',
  })
  @IsString()
  @MinLength(8)
  @MaxUtf8Bytes(72)
  password: string;

  @ApiProperty({
    description: 'Stable identifier for this browser or app installation.',
    maxLength: 255,
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  deviceId: string;

  @ApiPropertyOptional({ example: 'Chrome on Windows', maxLength: 255 })
  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceName?: string;
}
