import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { MaxUtf8Bytes, Trim } from './center-validation.decorators';

/**
 * The public activation body.
 *
 * Everything not declared here is rejected by the global pipe, which is what
 * stops a caller naming a `studentId` or a `centerId`. The key alone decides
 * which account is being activated — it is the credential.
 */
export class ActivateStudentDto {
  @ApiProperty({
    description: 'The one-time key the student received from their center.',
    maxLength: 256,
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  key: string;

  @ApiProperty({
    minLength: 8,
    format: 'password',
    description:
      'Chosen by the student. The center never learns it. Maximum 72 UTF-8 bytes.',
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

  @ApiPropertyOptional({ example: 'Android', maxLength: 255 })
  @Trim()
  @IsString()
  @MaxLength(255)
  deviceName?: string;
}

export class StudentTokenPairDto {
  @ApiProperty() accessToken: string;
  @ApiProperty() refreshToken: string;
}
