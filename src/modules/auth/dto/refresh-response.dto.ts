import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionStatusDto } from './subscription-status.dto';

export class RefreshResponseDto {
  @ApiProperty({ description: 'New short-lived Bearer access token.' })
  accessToken: string;

  @ApiProperty({
    description:
      'New rotating refresh token. The submitted refresh token is invalid after this response.',
  })
  refreshToken: string;

  @ApiPropertyOptional({
    type: SubscriptionStatusDto,
    description:
      'Where the student stands. Refresh succeeds even when blocked, so this is how a client learns it is blocked without waiting for a 403. Absent if the subscription could not be read; that never fails the refresh.',
  })
  subscription?: SubscriptionStatusDto;
}
