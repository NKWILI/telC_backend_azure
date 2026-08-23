import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
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
