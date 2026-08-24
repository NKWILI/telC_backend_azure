import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { CenterAccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { CenterExceptionFilter } from './center-exception.filter';
import { CenterSubscriptionService } from './center-subscription.service';
import { CurrentCenterUser } from './decorators/current-center-user.decorator';
import {
  CenterSubscriptionResponseDto,
  CenterUsageResponseDto,
} from './dto/center-subscription-response.dto';
import { CenterErrorResponseDto } from './dto/center-error-response.dto';
import {
  SubscriptionQuoteRequestDto,
  SubscriptionQuoteResponseDto,
} from './dto/subscription-quote.dto';
import { CenterAuthGuard } from './guards/center-auth.guard';

@ApiTags('Center Subscription')
@ApiBearerAuth()
@Controller('api/centers/me')
@UseFilters(CenterExceptionFilter)
@UseGuards(CenterAuthGuard)
export class CenterSubscriptionController {
  constructor(private readonly subscriptions: CenterSubscriptionService) {}

  @Get('subscription')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Read the signed-in center subscription',
    description:
      'Status is derived from the stored timestamps on every read, so it is correct even when no scheduled job has run. Remains reachable while BLOCKED, because a blocked center must still be able to see what it owes and pay it.',
  })
  @ApiOkResponse({ type: CenterSubscriptionResponseDto })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  @ApiNotFoundResponse({ type: CenterErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: CenterErrorResponseDto })
  async subscription(
    @CurrentCenterUser() centerUser: CenterAccessTokenPayload,
  ): Promise<CenterSubscriptionResponseDto> {
    return this.subscriptions.getSubscription(centerUser);
  }

  // No CenterSubscriptionGuard here, deliberately, as on every route in this
  // controller. A blocked center that cannot find out what it owes cannot pay,
  // and a center that cannot pay never comes back.
  @Post('subscription/quote')
  @ApiOperation({
    summary: 'Price a number of seats for the signed-in center',
    description:
      "The caller supplies a seat count and nothing else. The unit price comes from this center's own billing terms and the total is computed server-side; a request carrying a price, a total or another center id is rejected rather than ignored. Reachable while BLOCKED, because this is the first step of paying.",
  })
  @ApiCreatedResponse({ type: SubscriptionQuoteResponseDto })
  @ApiBadRequestResponse({
    type: CenterErrorResponseDto,
    description:
      'SEATS_BELOW_MINIMUM or SEATS_BELOW_STUDENT_COUNT, each carrying requiredSeats — the number this center has to reach.',
  })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  @ApiNotFoundResponse({ type: CenterErrorResponseDto })
  async quote(
    @CurrentCenterUser() centerUser: CenterAccessTokenPayload,
    @Body() dto: SubscriptionQuoteRequestDto,
  ): Promise<SubscriptionQuoteResponseDto> {
    return this.subscriptions.quote(centerUser, dto.seats);
  }

  @Get('usage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Read seat usage for the signed-in center',
    description:
      'A seat is a student carrying this center id, so usage is counted rather than stored and cannot drift. seatsAvailable is never negative.',
  })
  @ApiOkResponse({ type: CenterUsageResponseDto })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  @ApiNotFoundResponse({ type: CenterErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: CenterErrorResponseDto })
  async usage(
    @CurrentCenterUser() centerUser: CenterAccessTokenPayload,
  ): Promise<CenterUsageResponseDto> {
    return this.subscriptions.getUsage(centerUser);
  }
}
