import { ApiProperty } from '@nestjs/swagger';

export class RefreshResponseDto {
  @ApiProperty({ description: 'New short-lived Bearer access token.' })
  accessToken: string;

  @ApiProperty({
    description:
      'New rotating refresh token. The submitted refresh token is invalid after this response.',
  })
  refreshToken: string;
}
