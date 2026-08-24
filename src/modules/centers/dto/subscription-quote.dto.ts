import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { MAX_SEATS } from '../pricing.service';

/**
 * The entire quote request. One field, on purpose.
 *
 * The global pipe runs with `forbidNonWhitelisted`, so anything else a caller
 * sends — a unit price, a total, another center's id — is refused rather than
 * ignored. That refusal is the security boundary: quietly dropping an
 * unexpected `amount` would leave a client believing it had set the price.
 */
export class SubscriptionQuoteRequestDto {
  @ApiProperty({
    minimum: 1,
    maximum: MAX_SEATS,
    example: 10,
    description:
      'How many seats to price. The floor is the higher of the plan minimum and the students this center already has; both are enforced server-side.',
  })
  // No `@Type(() => Number)`. That belongs on query strings, where everything
  // arrives as text; here it would coerce "10" into 10 and accept a body that
  // is not the shape this endpoint documents. JSON has real numbers, so a
  // string seat count is a client bug worth reporting rather than repairing.
  @IsInt()
  @Min(1)
  @Max(MAX_SEATS)
  seats: number;
}

export class SubscriptionQuoteResponseDto {
  @ApiProperty({ example: 10 })
  seats: number;

  @ApiProperty({
    example: 4800,
    description:
      "This center's contracted price per seat, in whole XAF. Read from its own billing terms, never from the request.",
  })
  unitPriceXaf: number;

  @ApiProperty({
    example: 48000,
    description: 'seats x unitPriceXaf, in whole XAF. XAF has no minor units.',
  })
  amountXaf: number;
}
