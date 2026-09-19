import { IsNotEmpty, IsString, IsOptional } from 'class-validator';
import { StrongPassword } from '../../../shared/strong-password.decorator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ResetPasswordRequestDto {
  @ApiProperty({
    description: 'One-time token received through the password-recovery email.',
  })
  @IsNotEmpty()
  @IsString()
  token: string;

  @ApiProperty({
    minLength: 8,
    format: 'password',
    description:
      'At least 8 characters with an uppercase letter, a digit and a special character; at most 72 bytes (T2).',
  })
  @IsNotEmpty()
  @StrongPassword()
  newPassword: string;

  @ApiProperty({
    description: 'Stable identifier for this browser or app installation.',
  })
  @IsNotEmpty()
  @IsString()
  deviceId: string;

  @ApiPropertyOptional({ example: 'Chrome on Windows' })
  @IsOptional()
  @IsString()
  deviceName?: string;
}
