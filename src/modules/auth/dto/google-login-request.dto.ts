import { IsNotEmpty, IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GoogleLoginRequestDto {
  @ApiProperty({ description: 'Google OpenID Connect ID token.' })
  @IsNotEmpty()
  @IsString()
  idToken: string;

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
