import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Reported on login and refresh so a client knows where it stands before its
 * first learning call, instead of discovering a block through a 403.
 *
 * It is a report, never the enforcement point. StudentSubscriptionGuard is
 * what actually refuses access, on every request.
 */
export class SubscriptionStatusDto {
  @ApiProperty({
    enum: [
      'NONE',
      'TRIAL_PENDING',
      'TRIAL',
      'ACTIVE',
      'GRACE_PERIOD',
      'BLOCKED',
    ],
    description:
      'NONE means no center governs this student, which is distinct from BLOCKED: one has no school, the other has a school that stopped paying.',
  })
  status: string;

  @ApiProperty({
    example: true,
    description:
      'True for TRIAL, ACTIVE, GRACE_PERIOD and NONE. When false, every learning route answers 403 SUBSCRIPTION_INACTIVE.',
  })
  studentsMayLearn: boolean;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    format: 'date-time',
    description:
      'When a lapsed paid period stops working. Null on a trial, which has no grace.',
  })
  graceEndsAt: Date | null;
}
