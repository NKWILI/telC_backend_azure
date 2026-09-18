import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
