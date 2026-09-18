import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentStudent } from '../../shared/decorators/current-student.decorator';
import { GuestBlockGuard } from '../../shared/guards/guest-block.guard';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import type { AccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { RateLimitService } from '../../shared/services/rate-limit.service';
import { CenterExceptionFilter } from './center-exception.filter';
import { CodeRedemptionService } from './code-redemption.service';
import { CenterErrorResponseDto } from './dto/center-error-response.dto';
import { RedeemCodeDto, RedemptionResultDto } from './dto/code-redemption.dto';

/**
 * Lives with the centers module although its path is under `/api/auth`: a
 * code is a center's seat, and everything that decides whether it is worth
 * anything — the code, the center, its subscription — is here. The path is
 * the student's view of it, next to login.
 */
@ApiTags('Student Access')
@ApiBearerAuth()
@Controller('api/auth')
@UseFilters(CenterExceptionFilter)
export class CodeRedemptionController {
  constructor(
    private readonly redemption: CodeRedemptionService,
    private readonly rateLimitService: RateLimitService,
  ) {}

  @Post('redeem-code')
  @HttpCode(HttpStatus.OK)
  // A real account, not a guest: a seat is given to someone the center can
  // see by name, and a guest session has none.
  @UseGuards(JwtAuthGuard, GuestBlockGuard)
  @ApiOperation({
    summary: 'Redeem an activation code from a school',
    description:
      'Done once. The student gets the code seat and the plan it carries; from then on they log in normally and access is checked on every request. Case, spaces and dashes are forgiven. Refused: CODE_INVALID (unknown or malformed, answered alike), CODE_ALREADY_USED, CODE_DEACTIVATED, CODE_EXPIRED, CENTER_NOT_ACTIVE, STUDENT_ALREADY_ACTIVE. Re-entering the code the student already holds answers with their access. Rate limited per student and per IP, because codes are stored readable and this is the only place one could be guessed.',
  })
  @ApiOkResponse({ type: RedemptionResultDto })
  @ApiBadRequestResponse({ type: CenterErrorResponseDto })
  @ApiConflictResponse({ type: CenterErrorResponseDto })
  @ApiForbiddenResponse({ type: CenterErrorResponseDto })
  @ApiTooManyRequestsResponse({ type: CenterErrorResponseDto })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  async redeem(
    @CurrentStudent() student: AccessTokenPayload,
    @Body() dto: RedeemCodeDto,
    @Ip() ip: string,
  ): Promise<RedemptionResultDto> {
    // Before anything is looked up, so a flood of guesses costs nothing.
    await this.rateLimitService.checkCodeRedeemLimit(
      student.studentId,
      ip || 'unknown',
    );

    return this.redemption.redeem(student, dto.code, ip);
  }
}
