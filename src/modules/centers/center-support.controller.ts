import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { CenterAccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { CenterExceptionFilter } from './center-exception.filter';
import { CenterSupportService } from './center-support.service';
import { CurrentCenterUser } from './decorators/current-center-user.decorator';
import { CenterErrorResponseDto } from './dto/center-error-response.dto';
import {
  SupportContactDto,
  SupportRequestCreatedDto,
} from './dto/center-support.dto';
import { CenterAuthGuard } from './guards/center-auth.guard';

/**
 * No subscription guard: a school whose subscription lapsed is exactly the
 * one that needs to write to us, or to ask for its account to be deleted.
 */
@ApiTags('Center Support')
@ApiBearerAuth()
@Controller('api')
@UseFilters(CenterExceptionFilter)
@UseGuards(CenterAuthGuard)
export class CenterSupportController {
  constructor(private readonly support: CenterSupportService) {}

  @Post('support/contact')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Send a message to the Lerniqo team',
    description:
      'Stored, then emailed to the team with reply-to the email given; the manager gets an acknowledgement at the account email. 5 per hour per center (D24).',
  })
  @ApiCreatedResponse({ type: SupportRequestCreatedDto })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  @ApiTooManyRequestsResponse({
    type: CenterErrorResponseDto,
    description: 'RATE_LIMIT_EXCEEDED',
  })
  contact(
    @CurrentCenterUser() centerUser: CenterAccessTokenPayload,
    @Body() body: SupportContactDto,
  ): Promise<SupportRequestCreatedDto> {
    return this.support.contact(centerUser, body);
  }

  @Post('centers/me/deletion-request')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Ask the Lerniqo team to delete this account',
    description:
      'Deletes nothing. The team is emailed and contacts the manager; the manager gets a confirmation. Seats, codes, students and payments stay as they are. 3 per day per center (D37).',
  })
  @ApiCreatedResponse({ type: SupportRequestCreatedDto })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  @ApiTooManyRequestsResponse({
    type: CenterErrorResponseDto,
    description: 'RATE_LIMIT_EXCEEDED',
  })
  requestDeletion(
    @CurrentCenterUser() centerUser: CenterAccessTokenPayload,
  ): Promise<SupportRequestCreatedDto> {
    return this.support.requestDeletion(centerUser);
  }
}
