import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { CenterAccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { CenterActivationCodesService } from './center-activation-codes.service';
import { CenterExceptionFilter } from './center-exception.filter';
import { CurrentCenterUser } from './decorators/current-center-user.decorator';
import {
  ActivationCodeDto,
  ListActivationCodesQueryDto,
  ListedActivationCodeDto,
  SeatSummaryDto,
} from './dto/activation-code.dto';
import { CenterErrorResponseDto } from './dto/center-error-response.dto';
import { CenterAuthGuard } from './guards/center-auth.guard';
import { CenterSubscriptionGuard } from './guards/center-subscription.guard';

@ApiTags('Center Activation Codes')
@ApiBearerAuth()
@Controller('api/centers/me')
@UseFilters(CenterExceptionFilter)
@UseGuards(CenterAuthGuard)
export class CenterActivationCodesController {
  constructor(private readonly codes: CenterActivationCodesService) {}

  @Get('activation-codes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List the signed-in center activation codes',
    description:
      'Newest first. Filter by `status` and `planId`, each one value or `all`. Always readable, even before the account is finalized or while it is blocked: seeing what it holds is how a center decides to pay. There is no route to create or delete a code; codes come from a trial or a payment.',
  })
  @ApiOkResponse({ type: [ListedActivationCodeDto] })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  async list(
    @CurrentCenterUser() centerUser: CenterAccessTokenPayload,
    @Query() query: ListActivationCodesQueryDto,
  ): Promise<ListedActivationCodeDto[]> {
    return this.codes.list(centerUser, query);
  }

  @Get('seats')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Seats bought against seats in use, per plan',
    description:
      'Bought comes from the seat rows; used is the number of codes a student has redeemed, so it always matches the list.',
  })
  @ApiOkResponse({ type: SeatSummaryDto })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  async seats(
    @CurrentCenterUser() centerUser: CenterAccessTokenPayload,
  ): Promise<SeatSummaryDto> {
    return this.codes.seats(centerUser);
  }

  @Post('activation-codes/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  // A blocked center is refused here with SUBSCRIPTION_INACTIVE; an
  // unfinalized one by the service with ACCOUNT_NOT_FINALIZED.
  @UseGuards(CenterSubscriptionGuard)
  @ApiOperation({
    summary: 'Take a code back',
    description:
      'From `activated` or `connected` to `deactivated`. A connected student loses access on their next request; their name and email stay on the code so the center can see whose seat it was. A code already deactivated is returned unchanged. Recorded in the code history.',
  })
  @ApiOkResponse({ type: ActivationCodeDto })
  @ApiForbiddenResponse({
    type: CenterErrorResponseDto,
    description: 'ACCOUNT_NOT_FINALIZED or SUBSCRIPTION_INACTIVE.',
  })
  @ApiNotFoundResponse({ type: CenterErrorResponseDto })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  async deactivate(
    @CurrentCenterUser() centerUser: CenterAccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ActivationCodeDto> {
    return this.codes.deactivate(centerUser, id);
  }

  @Post('activation-codes/:id/reset')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CenterSubscriptionGuard)
  @ApiOperation({
    summary: 'Hand a seat to a new student: a new value for the same seat',
    description:
      'Gives the code a NEW value on the same row (same seat, plan and expiry) and sets it `activated`. The old value stops existing: typing it answers CODE_INVALID. A connected student loses access at once. Logged with the old value. A code that has been redeemed since its last reset may be reset 2 times per billing period (1 during the trial); a code nobody redeemed resets freely. Over the limit: CODE_RESET_LIMIT_REACHED with `resetsAvailableAt`. CODE_CHANGED when the code changed while the request was in flight. The learning data of the previous student on this seat is hidden at once and erased 7 days later (D39).',
  })
  @ApiOkResponse({ type: ActivationCodeDto })
  @ApiConflictResponse({
    type: CenterErrorResponseDto,
    description: 'CODE_RESET_LIMIT_REACHED or CODE_CHANGED.',
  })
  @ApiForbiddenResponse({
    type: CenterErrorResponseDto,
    description: 'ACCOUNT_NOT_FINALIZED or SUBSCRIPTION_INACTIVE.',
  })
  @ApiNotFoundResponse({ type: CenterErrorResponseDto })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  async reset(
    @CurrentCenterUser() centerUser: CenterAccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ActivationCodeDto> {
    return this.codes.reset(centerUser, id);
  }
}
