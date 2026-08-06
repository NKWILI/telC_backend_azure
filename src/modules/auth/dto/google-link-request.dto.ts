import { IsNotEmpty, IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GoogleLinkRequestDto {
  @ApiProperty({
    description:
      'Short-lived linking token returned by the legacy Google login flow.',
  })
  @IsNotEmpty()
  @IsString()
  linkingToken: string;

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
