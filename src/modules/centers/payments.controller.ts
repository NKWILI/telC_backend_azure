import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { CenterAccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { CenterExceptionFilter } from './center-exception.filter';
import { CurrentCenterUser } from './decorators/current-center-user.decorator';
import { CenterErrorResponseDto } from './dto/center-error-response.dto';
import {
  CreatePaymentDto,
  ListPaymentsQueryDto,
  PaymentPageDto,
  PaymentResponseDto,
} from './dto/payments.dto';
import { CenterAuthGuard } from './guards/center-auth.guard';
import { RateLimitService } from '../../shared/services/rate-limit.service';
import { PaymentsService } from './payments.service';

/** Long enough for a uuid or a nanoid, short enough not to be a payload. */
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

/**
 * Payments for the signed-in center.
 *
 * NOTE FOR ANYONE HARDENING THIS LATER: there is deliberately no
 * `CenterSubscriptionGuard` here, and adding one would be a revenue bug rather
 * than a security fix. These routes are how a lapsed center pays; a blocked
 * center that cannot reach them can never come back. `payments.controller.spec`
 * asserts their absence so the mistake fails a test instead of shipping.
 *
 * The routes carry explicit full paths rather than a shared prefix, because
 * history is specified at `/api/centers/me/payments` while an individual
 * payment lives at `/api/payments/:id`. Keeping them in one controller keeps
 * the guard decision above in one place.
 */
@ApiTags('Center Payments')
@ApiBearerAuth()
@Controller()
@UseFilters(CenterExceptionFilter)
@UseGuards(CenterAuthGuard)
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly rateLimitService: RateLimitService,
  ) {}

  @Post('api/payments')
  @ApiOperation({
    summary: 'Record an intent to pay for seats',
    description:
      "Creates a PENDING payment priced from this center's own billing terms. It grants nothing: only a verified provider event may activate a subscription. Retrying with the same Idempotency-Key returns the original record; reusing it with different seats is a 409.",
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'A value unique to this attempt, such as a uuid. Retrying with it is safe; reusing it for a different purchase is refused.',
  })
  @ApiCreatedResponse({ type: PaymentResponseDto })
  @ApiBadRequestResponse({ type: CenterErrorResponseDto })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  @ApiConflictResponse({
    type: CenterErrorResponseDto,
    description: 'IDEMPOTENCY_KEY_REUSED — same key, different purchase.',
  })
  async create(
    @CurrentCenterUser() centerUser: CenterAccessTokenPayload,
    @Body() dto: CreatePaymentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<PaymentResponseDto> {
    // Mapped field by field onto the tier keys rather than passed through, so
    // an unexpected property on the body can never reach pricing.
    const mix = { START: dto.start, PRO: dto.pro, PREMIUM: dto.premium };

    // Refused before any budget is spent. Every tier field is optional, so an
    // empty body clears the validation pipe and arrives here; charging a slot
    // for a request that buys nothing lets twenty empty submits lock a center
    // out of the one route a lapsed center has to be able to reach. This is a
    // pure check — no database, no writes — so doing it first costs nothing.
    // The service checks again, because it must hold for any caller.
    this.requireSomethingToBuy(mix);

    // Keyed on the center, not the IP: the caller is authenticated, and what
    // needs protecting is this center's own row count. The idempotency index
    // stops duplicates of ONE intent; nothing stops a flood of distinct ones,
    // because a fresh key is a fresh payment by design.
    await this.rateLimitService.checkPaymentCreateLimit(centerUser.centerId);

    return this.payments.create(
      centerUser,
      mix,
      this.requireIdempotencyKey(idempotencyKey),
    );
  }

  @Get('api/centers/me/payments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List this center payment history, newest first',
    description:
      'Scoped to the signed-in center. There is no route that lists another center payments.',
  })
  @ApiOkResponse({ type: PaymentPageDto })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  async list(
    @CurrentCenterUser() centerUser: CenterAccessTokenPayload,
    @Query() query: ListPaymentsQueryDto,
  ): Promise<PaymentPageDto> {
    return this.payments.list(centerUser, query);
  }

  @Get('api/payments/:paymentId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Read one payment',
    description:
      'Another center payment answers 404, never 403 — a 403 would confirm the id exists.',
  })
  @ApiOkResponse({ type: PaymentResponseDto })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  @ApiNotFoundResponse({ type: CenterErrorResponseDto })
  async get(
    @CurrentCenterUser() centerUser: CenterAccessTokenPayload,
    @Param('paymentId') paymentId: string,
  ): Promise<PaymentResponseDto> {
    return this.payments.get(centerUser, paymentId);
  }

  /**
   * Whether this body asks to buy anything at all.
   *
   * Deliberately the same code `PricingService` raises for the same condition,
   * so a client sees one answer to one mistake regardless of which layer
   * noticed. The rule cannot live in the DTO: `class-validator` runs per
   * property, and "at least one of these three" is a statement about the
   * object.
   */
  private requireSomethingToBuy(mix: Record<string, number | undefined>): void {
    const wanted = Object.values(mix).some(
      (seats) => typeof seats === 'number' && seats > 0,
    );

    if (!wanted) {
      throw new BadRequestException('SEAT_MIX_EMPTY');
    }
  }

  /**
   * Validated here rather than in the DTO because it is a header.
   *
   * Required, not optional with a generated fallback: a server-invented key
   * makes every retry a new payment, which is the exact failure idempotency
   * exists to prevent. Better to refuse the request than to silently offer no
   * protection.
   */
  private requireIdempotencyKey(raw?: string): string {
    const key = raw?.trim();

    if (!key || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new BadRequestException('IDEMPOTENCY_KEY_REQUIRED');
    }

    return key;
  }
}
