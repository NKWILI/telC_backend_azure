import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseFilters,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CenterExceptionFilter } from './center-exception.filter';
import {
  PaymentWebhookService,
  type WebhookReceipt,
} from './payment-webhook.service';

/**
 * Where a payment provider reports what happened to a payment.
 *
 * NO AUTHENTICATION GUARD, deliberately. The provider holds no center or
 * student token; the webhook signature is the authentication, verified over
 * the raw request bytes before anything else happens. A guard here would
 * refuse every genuine delivery. `payment-webhooks.controller.spec` pins the
 * absence.
 *
 * Provider-neutral path: swapping the fake provider for Notch Pay changes
 * nothing downstream. If Notch Pay's dashboard needs a different path, add a
 * route that calls the same service.
 */
@ApiTags('Payment Webhooks')
@Controller('api/webhooks/payments')
@UseFilters(CenterExceptionFilter)
export class PaymentWebhooksController {
  constructor(private readonly webhooks: PaymentWebhookService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive a payment provider event',
    description:
      'Called by the payment provider, never by a client. The signature is verified over the raw body before anything is read; an unverified event is refused and changes nothing. Answers 200 for a first delivery and for a duplicate alike, 404 for a reference no payment holds so the provider retries, and 503 when no provider is configured.',
  })
  async receive(
    @Req() request: RawBodyRequest<Request>,
  ): Promise<WebhookReceipt> {
    return this.webhooks.handle(request.rawBody, request.headers);
  }
}
