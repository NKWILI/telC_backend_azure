import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

/**
 * Filters for the Users page. Each takes one value or `all`, which is what the
 * page's dropdowns send; absent means the same as `all`.
 */
export class ListActivationCodesQueryDto {
  @ApiPropertyOptional({
    enum: ['activated', 'connected', 'deactivated', 'all'],
  })
  @IsOptional()
  @IsIn(['activated', 'connected', 'deactivated', 'all'])
  status?: 'activated' | 'connected' | 'deactivated' | 'all';

  @ApiPropertyOptional({ enum: ['start', 'pro', 'premium', 'all'] })
  @IsOptional()
  @IsIn(['start', 'pro', 'premium', 'all'])
  planId?: 'start' | 'pro' | 'premium' | 'all';
}

export class SeatsByPlanDto {
  @ApiProperty({ example: 7 }) start: number;
  @ApiProperty({ example: 3 }) pro: number;
  @ApiProperty({ example: 0 }) premium: number;
}

export class SeatSummaryDto {
  @ApiProperty({
    type: SeatsByPlanDto,
    description: 'Seats held per plan, from the seat rows.',
  })
  bought: SeatsByPlanDto;

  @ApiProperty({
    type: SeatsByPlanDto,
    description:
      'Codes a student has redeemed, per plan. Counted from the codes themselves, so it always matches the list.',
  })
  used: SeatsByPlanDto;

  @ApiProperty({ example: 10 }) boughtTotal: number;
  @ApiProperty({ example: 6 }) usedTotal: number;
}

/** A code as every route returns it. Mirrors `ActivationCodeView`. */
export class ActivationCodeDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    example: 'LQ-7K2P-94QX',
    description:
      'What the manager reads out and the student types. No 0/O, 1/I/L or U, so it survives the phone and paper.',
  })
  code: string;

  @ApiProperty({
    enum: ['activated', 'connected', 'deactivated'],
    example: 'activated',
    description:
      '`activated` waits for a student, `connected` has one, `deactivated` was taken back. Expiry is not a status — compare `expiresAt`.',
  })
  status: 'activated' | 'connected' | 'deactivated';

  @ApiProperty({ enum: ['start', 'pro', 'premium'], example: 'start' })
  planId: 'start' | 'pro' | 'premium';

  @ApiPropertyOptional({ nullable: true, example: 'Amina Nguema' })
  linkedName: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'amina@example.com' })
  linkedEmail: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  connectedAt: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    format: 'date-time',
    description:
      'When the seat stops working. A trial code ends with the trial. Null means the code follows the center subscription rather than a date of its own.',
  })
  expiresAt: Date | null;
}

export class TrialStartedDto {
  @ApiProperty({
    type: String,
    format: 'date-time',
    description:
      'Fourteen days from the moment the trial was started. The code below expires at the same instant.',
  })
  trialEndsAt: Date;

  @ApiProperty({
    type: ActivationCodeDto,
    description:
      'The one code the trial comes with. Re-read `GET /api/centers/me` for the account state it changed.',
  })
  code: ActivationCodeDto;
}

/** What a reset of this code would cost, shown before the manager acts (D39). */
export class CodeResetAllowanceDto {
  @ApiProperty({
    example: true,
    description:
      'Whether a reset now counts against the limit: the code has been redeemed since its last reset. A code nobody redeemed resets freely.',
  })
  counted: boolean;

  @ApiProperty({
    example: 1,
    description:
      'Resets of a used code left in this period: 2 per paid billing period, 1 during the trial.',
  })
  remaining: number;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    format: 'date-time',
    description:
      'When more resets become available: the next renewal. Null during the trial, where the allowance does not refill.',
  })
  availableAt: Date | null;
}

export class ListedActivationCodeDto extends ActivationCodeDto {
  @ApiProperty({ type: CodeResetAllowanceDto })
  reset: CodeResetAllowanceDto;
}
