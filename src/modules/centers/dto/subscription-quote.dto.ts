import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { MAX_SEATS_TOTAL } from '../pricing.service';

/**
 * The seats a center wants, per tier.
 *
 * THE NUMBERS ARE TOTALS, not increments. A center holding ten Start seats
 * that wants five more sends fifteen. That is also why the server can compare
 * them directly against the students already in each tier.
 *
 * The global pipe runs with `forbidNonWhitelisted`, so a price, a total, a
 * currency or another center's id is refused rather than ignored. That refusal
 * is the security boundary of the whole phase: quietly dropping an `amount`
 * would leave a client believing it had set the price.
 */
export class SubscriptionQuoteRequestDto {
  @ApiPropertyOptional({
    minimum: 0,
    maximum: MAX_SEATS_TOTAL,
    example: 5,
    description: 'Total Start seats to hold. Omit or send 0 to hold none.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_SEATS_TOTAL)
  start?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: MAX_SEATS_TOTAL,
    example: 3,
    description: 'Total Pro seats to hold. Pro unlocks the exam module.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_SEATS_TOTAL)
  pro?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: MAX_SEATS_TOTAL,
    example: 2,
    description: 'Total Premium seats to hold.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_SEATS_TOTAL)
  premium?: number;
}

export class QuoteLineDto {
  @ApiProperty({ enum: ['START', 'PRO', 'PREMIUM'], example: 'START' })
  tier: string;

  @ApiProperty({ example: 5 })
  seats: number;

  @ApiProperty({
    example: 4500,
    description:
      "What this center pays per seat in this tier. Its own stamped price if it already holds the tier, otherwise today's list price. Never read from the request.",
  })
  unitPriceXaf: number;

  @ApiProperty({ example: 22500, description: 'seats x unitPriceXaf.' })
  amountXaf: number;
}

/**
 * Itemised rather than a bare total.
 *
 * A school about to spend 92,500 XAF needs to see where the number comes from,
 * and a total alone invites the client to recompute the breakdown itself —
 * which is how a second, drifting pricing implementation gets born.
 */
export class SubscriptionQuoteResponseDto {
  @ApiProperty({ type: [QuoteLineDto] })
  lines: QuoteLineDto[];

  @ApiProperty({ example: 10, description: 'Seats across every tier.' })
  totalSeats: number;

  @ApiProperty({ example: 92500, description: 'Whole XAF. No minor units.' })
  totalXaf: number;
}
