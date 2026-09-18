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
  ApiConflictResponse,
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
import { CenterTrialService } from './center-trial.service';
import { TrialStartedDto } from './dto/activation-code.dto';
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
  constructor(
    private readonly subscriptions: CenterSubscriptionService,
    private readonly trials: CenterTrialService,
  ) {}

  @Post('trial')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Start the free trial',
    description:
      'Starts a 14-day trial now and issues its one activation code, which expires with it. The clock starts at this call rather than at the first student redemption, so the school knows the end date the moment it has a code to hand out. One trial per center: a second call answers TRIAL_ALREADY_USED, and a center that has paid answers ALREADY_PAID. Two calls arriving together start one trial. The trial seat is a Start seat at zero price.',
  })
  @ApiCreatedResponse({ type: TrialStartedDto })
  @ApiConflictResponse({
    type: CenterErrorResponseDto,
    description: 'TRIAL_ALREADY_USED or ALREADY_PAID.',
  })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  @ApiNotFoundResponse({ type: CenterErrorResponseDto })
  async startTrial(
    @CurrentCenterUser() centerUser: CenterAccessTokenPayload,
  ): Promise<TrialStartedDto> {
    return this.trials.start(centerUser);
  }

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
      'SEATS_BELOW_MINIMUM or SEATS_BELOW_STUDENT_COUNT carries requiredSeatsTotal. A tier-floor refusal also carries requiredSeatsPerTier for every occupied tier, so applying it cannot uncover another tier refusal. AMOUNT_ABOVE_MAXIMUM carries maximumAmountXaf.',
  })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  @ApiNotFoundResponse({ type: CenterErrorResponseDto })
  async quote(
    @CurrentCenterUser() centerUser: CenterAccessTokenPayload,
    @Body() dto: SubscriptionQuoteRequestDto,
  ): Promise<SubscriptionQuoteResponseDto> {
    // Mapped field by field onto the tier keys rather than passed through, so
    // an unexpected property on the body can never reach pricing even if the
    // global pipe were ever relaxed.
    return this.subscriptions.quote(centerUser, {
      START: dto.start,
      PRO: dto.pro,
      PREMIUM: dto.premium,
    });
  }

  @Get('usage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Read seat usage for the signed-in center',
    description:
      'A seat is a student carrying this center id, so usage is counted rather than stored and cannot drift. seatsAvailable is never negative; legacy students without a tier are reported in unassignedSeatsUsed.',
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
