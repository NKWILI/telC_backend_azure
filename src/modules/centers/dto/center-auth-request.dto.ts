import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
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

export class CenterForgotPasswordDto {
  @ApiProperty({ format: 'email', maxLength: 254 })
  @NormalizeEmail()
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  @IsEmail()
  email: string;
}

export class CenterResetPasswordDto {
  @ApiProperty({ format: 'email', maxLength: 254 })
  @NormalizeEmail()
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'Six-digit code from the reset email.' })
  @Trim()
  @IsString()
  @Matches(/^[0-9]{6}$/, { message: 'Reset code must be six digits' })
  code: string;

  // The registration minimum applies here: this call sets a new password, so
  // it is the policy boundary, unlike login which only checks an existing one.
  @ApiProperty({ minLength: 8, format: 'password' })
  @IsString()
  @MinLength(8)
  @MaxUtf8Bytes(72)
  newPassword: string;

  @ApiProperty({ maxLength: 255 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  deviceId: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceName?: string;
}

export class CenterRefreshTokenDto {
  @ApiProperty({
    description: 'The center refresh token issued by login or a prior refresh.',
    maxLength: 4096,
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  refreshToken: string;
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

  // Deliberately no minimum length. Login must not enforce the registration
  // policy: a password below the current minimum has to fail as
  // INVALID_CREDENTIALS, not as a validation error the caller cannot act on.
  // The 72-byte cap stays — it bounds work and matches bcrypt's truncation.
  @ApiProperty({
    format: 'password',
    description: 'Maximum 72 UTF-8 bytes.',
  })
  @IsString()
  @IsNotEmpty()
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
