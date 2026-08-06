import { IsNotEmpty, MinLength, IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ResetPasswordRequestDto {
  @ApiProperty({
    description: 'One-time token received through the password-recovery email.',
  })
  @IsNotEmpty()
  @IsString()
  token: string;

  @ApiProperty({ minLength: 8, format: 'password' })
  @IsNotEmpty()
  @MinLength(8)
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
