import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuthStudentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiPropertyOptional({ nullable: true, example: 'Ada' })
  firstName: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Lovelace' })
  lastName: string | null;

  @ApiProperty({ format: 'email', example: 'ada@example.com' })
  email: string;

  @ApiProperty({ example: true })
  emailVerified: boolean;
}

export class AuthTokenResponseDto {
  @ApiProperty({
    description: 'Short-lived JWT used as a Bearer access token.',
  })
  accessToken: string;

  @ApiProperty({
    description:
      'Single-use rotating refresh token. Store securely and replace it after every successful refresh.',
  })
  refreshToken: string;

  @ApiProperty({ type: AuthStudentDto })
  student: AuthStudentDto;
}

export class MessageResponseDto {
  @ApiProperty({ example: 'verification email sent' })
  message: string;
}

export class VerifiedResponseDto {
  @ApiProperty({ example: true })
  verified: true;
}

export class SuccessResponseDto {
  @ApiProperty({ example: true })
  success: true;
}

export class DeviceSessionResponseDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Server-side session identifier.',
  })
  id: string;

  @ApiProperty({ example: 'browser-installation-7f6a' })
  device_id: string;

  @ApiPropertyOptional({ nullable: true, example: 'Chrome on Windows' })
  device_name: string | null;

  @ApiProperty({ format: 'date-time' })
  last_used_at: Date;

  @ApiProperty({ format: 'date-time' })
  created_at: Date;
}

export class AuthErrorResponseDto {
  @ApiProperty({ example: 'INVALID_REFRESH_TOKEN' })
  error: string;

  @ApiProperty({ example: 'Invalid refresh token.' })
  message: string | string[];
}

export class GoogleLinkingRequiredDto {
  @ApiProperty({ enum: ['LINKING_REQUIRED'] })
  status: 'LINKING_REQUIRED';

  @ApiProperty({
    description: 'Short-lived token used by the Google linking endpoint.',
  })
  linkingToken: string;
}
