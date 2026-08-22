import { Body, Controller, Ip, Post, UseFilters } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RateLimitService } from '../../shared/services/rate-limit.service';
import { CenterAuthService } from './center-auth.service';
import { CenterExceptionFilter } from './center-exception.filter';
import {
  CenterLoginDto,
  CenterRefreshTokenDto,
  VerifyCenterEmailDto,
} from './dto/center-auth-request.dto';
import {
  CenterAuthResponseDto,
  CenterLogoutResponseDto,
  CenterTokenPairDto,
} from './dto/center-auth-response.dto';
import { CenterErrorResponseDto } from './dto/center-error-response.dto';

@ApiTags('Center Authentication')
@Controller('api/center-auth')
@UseFilters(CenterExceptionFilter)
export class CenterAuthController {
  constructor(
    private readonly centerAuthService: CenterAuthService,
    private readonly rateLimitService: RateLimitService,
  ) {}

  @Post('verify-email')
  @ApiOperation({
    summary: 'Verify a center owner email and start a device session',
    description:
      'Consumes the one-time verification token and returns a center access/refresh token pair bound to deviceId.',
  })
  @ApiCreatedResponse({ type: CenterAuthResponseDto })
  @ApiBadRequestResponse({ type: CenterErrorResponseDto })
  @ApiTooManyRequestsResponse({ type: CenterErrorResponseDto })
  @ApiInternalServerErrorResponse({ type: CenterErrorResponseDto })
  @ApiResponse({
    status: 503,
    type: CenterErrorResponseDto,
    description: 'Session transaction retries were exhausted.',
  })
  async verifyEmail(
    @Ip() ip: string,
    @Body() dto: VerifyCenterEmailDto,
  ): Promise<CenterAuthResponseDto> {
    await this.rateLimitService.checkCenterVerifyEmailLimit(ip || 'unknown');
    return this.centerAuthService.verifyEmail(dto);
  }

  @Post('login')
  @ApiOperation({
    summary: 'Log in a verified center owner',
    description:
      'Validates center credentials and creates or rotates the session for this deviceId.',
  })
  @ApiCreatedResponse({ type: CenterAuthResponseDto })
  @ApiBadRequestResponse({ type: CenterErrorResponseDto })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  @ApiForbiddenResponse({ type: CenterErrorResponseDto })
  @ApiTooManyRequestsResponse({ type: CenterErrorResponseDto })
  @ApiInternalServerErrorResponse({ type: CenterErrorResponseDto })
  @ApiResponse({
    status: 503,
    type: CenterErrorResponseDto,
    description: 'Session transaction retries were exhausted.',
  })
  async login(
    @Ip() ip: string,
    @Body() dto: CenterLoginDto,
  ): Promise<CenterAuthResponseDto> {
    await this.rateLimitService.checkCenterLoginLimit(
      ip || 'unknown',
      dto.email,
    );
    return this.centerAuthService.login(dto);
  }

  /**
   * Refresh and logout are not rate limited. Both require an unguessable
   * signed token, so login remains the brute-force boundary; adding throttling
   * here is a separate policy decision.
   */
  @Post('refresh')
  @ApiOperation({
    summary: 'Exchange a center refresh token for a new pair',
    description:
      'The submitted token is single-use. Replayed, revoked, mismatched-device, student, and guest tokens all return the same 401.',
  })
  @ApiCreatedResponse({ type: CenterTokenPairDto })
  @ApiBadRequestResponse({ type: CenterErrorResponseDto })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  @ApiInternalServerErrorResponse({ type: CenterErrorResponseDto })
  async refresh(
    @Body() dto: CenterRefreshTokenDto,
  ): Promise<CenterTokenPairDto> {
    return this.centerAuthService.refresh(dto);
  }

  @Post('logout')
  @ApiOperation({
    summary: 'Revoke the center session the refresh token belongs to',
    description:
      'Revokes only this device session. Repeating logout for an already-revoked session succeeds; a token superseded by a refresh returns 401.',
  })
  @ApiCreatedResponse({ type: CenterLogoutResponseDto })
  @ApiBadRequestResponse({ type: CenterErrorResponseDto })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  @ApiInternalServerErrorResponse({ type: CenterErrorResponseDto })
  async logout(
    @Body() dto: CenterRefreshTokenDto,
  ): Promise<CenterLogoutResponseDto> {
    return this.centerAuthService.logout(dto);
  }
}
