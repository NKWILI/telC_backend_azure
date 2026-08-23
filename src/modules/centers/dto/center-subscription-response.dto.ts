import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const CENTER_SUBSCRIPTION_STATUSES = [
  'TRIAL_PENDING',
  'TRIAL',
  'ACTIVE',
  'GRACE_PERIOD',
  'BLOCKED',
] as const;

export class CenterSubscriptionResponseDto {
  @ApiProperty({
    enum: CENTER_SUBSCRIPTION_STATUSES,
    description:
      'Derived from the timestamps on every read, never stored. TRIAL_PENDING lasts until the first student activates.',
  })
  status: (typeof CENTER_SUBSCRIPTION_STATUSES)[number];

  @ApiProperty({ enum: ['TRIAL', 'PAID'] })
  plan: string;

  @ApiProperty({
    example: 3,
    description:
      'The seat limit. 3 on trial, 10 or more once paid. Always the authority, whatever the status.',
  })
  seats: number;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  trialStartedAt: Date | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  trialEndsAt: Date | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  paidUntil: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    format: 'date-time',
    description:
      'When the 7-day grace on a lapsed paid period ends. Null when there is no paid period — an expired trial gets no grace.',
  })
  graceEndsAt: Date | null;

  @ApiProperty({
    description:
      'The single access decision. Clients must read this rather than re-deriving it from the dates.',
  })
  studentsMayLearn: boolean;
}

export class CenterUsageResponseDto {
  @ApiProperty({
    example: 0,
    description: 'Students carrying this center id. Counted, never stored.',
  })
  seatsUsed: number;

  @ApiProperty({ example: 3 })
  seatsLimit: number;

  @ApiProperty({
    example: 3,
    description:
      'Never negative. A center over its limit reports 0 — that blocks new provisioning without evicting anyone.',
  })
  seatsAvailable: number;

  @ApiProperty({ enum: CENTER_SUBSCRIPTION_STATUSES })
  status: (typeof CENTER_SUBSCRIPTION_STATUSES)[number];
}
