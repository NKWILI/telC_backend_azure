import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { MAX_SEATS_TOTAL } from '../pricing.service';
import { QuoteLineDto } from './subscription-quote.dto';

/**
 * The seats to pay for, per tier. Totals, not increments — the same shape the
 * quote endpoint takes, so a center pays for exactly what it was quoted.
 *
 * The idempotency key travels as a header rather than a field, following the
 * convention every payment API uses: it is part of how the request is made
 * rather than part of what is being bought.
 */
export class CreatePaymentDto {
  @ApiPropertyOptional({ minimum: 0, maximum: MAX_SEATS_TOTAL, example: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_SEATS_TOTAL)
  start?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: MAX_SEATS_TOTAL, example: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_SEATS_TOTAL)
  pro?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: MAX_SEATS_TOTAL, example: 2 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_SEATS_TOTAL)
  premium?: number;
}

export class PaymentResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;

  @ApiProperty({
    type: [QuoteLineDto],
    description:
      'The breakdown this payment was created from, each line carrying the price that applied at the time. An old invoice stays truthful after the list price moves.',
  })
  lines: QuoteLineDto[];

  @ApiProperty({ example: 10 }) totalSeats: number;
  @ApiProperty({ example: 92500 }) amountXaf: number;

  @ApiProperty({
    enum: ['PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED'],
    example: 'PENDING',
    description:
      'Always PENDING today. Only a verified provider event may advance it, and that arrives in Phase 7 — a payment record grants nothing on its own.',
  })
  status: string;

  @ApiProperty({ format: 'date-time' }) createdAt: Date;
}

export class ListPaymentsQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page = 1;

  // Capped for the same reason the student roster is: a dashboard refresh must
  // not be able to turn into an unbounded query.
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export class PaymentPageDto {
  @ApiProperty({ type: [PaymentResponseDto] }) payments: PaymentResponseDto[];
  @ApiProperty({ example: 1 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) pageSize: number;
}
