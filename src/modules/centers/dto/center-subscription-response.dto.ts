import { Tier } from '@prisma/client';
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
    example: 1,
    description:
      'Seats this center holds across every tier, summed from its seat rows. One on trial, ten or more once paid. Replaces the old `seats` field, which was a second number claiming the same thing.',
  })
  seatsHeld: number;

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

export class CenterTierUsageDto {
  @ApiProperty({ enum: Tier, example: Tier.START }) tier: Tier;
  @ApiProperty({ example: 10 }) seatsHeld: number;
  @ApiProperty({ example: 7 }) seatsUsed: number;
  @ApiProperty({
    example: 3,
    description:
      'Never negative. A tier dropped while students still sat in it reports 0 available and more used than held.',
  })
  seatsAvailable: number;
}

export class CenterUsageResponseDto {
  @ApiProperty({
    example: 0,
    description: 'Students carrying this center id. Counted, never stored.',
  })
  seatsUsed: number;

  @ApiProperty({
    example: 1,
    description:
      'Seats held across every tier. Zero for a center holding none.',
  })
  seatsLimit: number;

  @ApiProperty({
    example: 3,
    description:
      'Never negative. A center over its limit reports 0 — that blocks new provisioning without evicting anyone.',
  })
  seatsAvailable: number;

  @ApiProperty({
    example: 0,
    description:
      'Legacy students who occupy a center seat but have no tier assignment yet. Add this to perTier seatsUsed to reconcile with the total seatsUsed.',
  })
  unassignedSeatsUsed: number;

  @ApiProperty({
    type: [CenterTierUsageDto],
    description:
      'The same figures per tier, cheapest first. A seat belongs to a tier, so a total alone cannot answer "may I add a Start student" — which is what provisioning refuses on. A tier appears if the center holds seats in it or has students in it.',
  })
  perTier: CenterTierUsageDto[];

  @ApiProperty({ enum: CENTER_SUBSCRIPTION_STATUSES })
  status: (typeof CENTER_SUBSCRIPTION_STATUSES)[number];
}
