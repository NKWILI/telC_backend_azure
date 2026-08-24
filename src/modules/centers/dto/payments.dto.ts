import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { MAX_SEATS } from '../pricing.service';

/**
 * The entire create-payment body. Seats and nothing else.
 *
 * The idempotency key travels as a header rather than a field, following the
 * convention every payment API uses, so it stays part of how the request is
 * made rather than part of what is being bought.
 */
export class CreatePaymentDto {
  @ApiProperty({
    minimum: 1,
    maximum: MAX_SEATS,
    example: 10,
    description:
      "How many seats to pay for. The amount is computed server-side from this center's billing terms; sending a price, a total or a status is rejected.",
  })
  @IsInt()
  @Min(1)
  seats: number;
}

export class PaymentResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 10 }) seats: number;
  @ApiProperty({ example: 4800 }) unitPriceXaf: number;
  @ApiProperty({ example: 48000 }) amountXaf: number;

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
