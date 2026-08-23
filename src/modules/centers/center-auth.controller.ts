import { Body, Controller, Ip, Post, UseFilters } from '@nestjs/common';
import {
  ApiBadGatewayResponse,
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
import { CentersService } from './centers.service';
import { CenterExceptionFilter } from './center-exception.filter';
import {
  CenterForgotPasswordDto,
  CenterLoginDto,
  CenterRefreshTokenDto,
  CenterResetPasswordDto,
  VerifyCenterEmailDto,
  VerifyCenterEmailPublicDto,
} from './dto/center-auth-request.dto';
import {
  CenterAuthResponseDto,
  CenterLogoutResponseDto,
  CenterMessageResponseDto,
  CenterTokenPairDto,
} from './dto/center-auth-response.dto';
import { CenterErrorResponseDto } from './dto/center-error-response.dto';
import { RegisterCenterDto } from './dto/register-center.dto';

@ApiTags('Center Authentication')
@Controller('api/center-auth')
@UseFilters(CenterExceptionFilter)
export class CenterAuthController {
  constructor(
    private readonly centersService: CentersService,
    private readonly centerAuthService: CenterAuthService,
    private readonly rateLimitService: RateLimitService,
  ) {}

  @Post('register')
  @ApiOperation({
    summary: 'Register a language center and its owner',
    description:
      'Creates an unverified center account and sends a verification email. The response is identical when the email already exists.',
  })
  @ApiCreatedResponse({
    schema: { example: { message: 'verification email sent' } },
  })
  @ApiBadRequestResponse({ type: CenterErrorResponseDto })
  @ApiTooManyRequestsResponse({ type: CenterErrorResponseDto })
  @ApiBadGatewayResponse({ type: CenterErrorResponseDto })
  async register(
    @Ip() ip: string,
    @Body() dto: RegisterCenterDto,
  ): Promise<{ message: 'verification email sent' }> {
    await this.rateLimitService.checkCenterRegisterLimit(
      ip || 'unknown',
      dto.email,
    );
    return this.centersService.register(dto);
  }

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

  @Post('verify-email-public')
  @ApiOperation({
    summary: 'Verify a center email from the public website',
    description:
      'What the emailed link points at. Consumes the one-time token and creates no session, because a web page has no device identity and no safe place to keep a refresh token. The owner signs in from the app afterwards.',
  })
  @ApiCreatedResponse({ type: CenterMessageResponseDto })
  @ApiBadRequestResponse({ type: CenterErrorResponseDto })
  @ApiTooManyRequestsResponse({ type: CenterErrorResponseDto })
  async verifyEmailPublic(
    @Ip() ip: string,
    @Body() dto: VerifyCenterEmailPublicDto,
  ): Promise<CenterMessageResponseDto> {
    await this.rateLimitService.checkCenterVerifyEmailLimit(ip || 'unknown');
    return this.centerAuthService.verifyEmailPublic(dto);
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
  @Post('forgot-password')
  @ApiOperation({
    summary: 'Request a center password-reset code',
    description:
      'Always returns the same response, whether or not an account exists for the address.',
  })
  @ApiCreatedResponse({ type: CenterMessageResponseDto })
  @ApiBadRequestResponse({ type: CenterErrorResponseDto })
  @ApiTooManyRequestsResponse({ type: CenterErrorResponseDto })
  async forgotPassword(
    @Ip() ip: string,
    @Body() dto: CenterForgotPasswordDto,
  ): Promise<CenterMessageResponseDto> {
    await this.rateLimitService.checkCenterForgotPasswordLimit(ip || 'unknown');
    return this.centerAuthService.forgotPassword(dto);
  }

  @Post('reset-password')
  @ApiOperation({
    summary: 'Redeem a center password-reset code',
    description:
      'Consumes the one-time code, revokes every existing center session, and returns a new session for this device.',
  })
  @ApiCreatedResponse({ type: CenterAuthResponseDto })
  @ApiBadRequestResponse({ type: CenterErrorResponseDto })
  @ApiTooManyRequestsResponse({ type: CenterErrorResponseDto })
  @ApiInternalServerErrorResponse({ type: CenterErrorResponseDto })
  async resetPassword(
    @Ip() ip: string,
    @Body() dto: CenterResetPasswordDto,
  ): Promise<CenterAuthResponseDto> {
    await this.rateLimitService.checkCenterResetPasswordLimit(ip || 'unknown');
    return this.centerAuthService.resetPassword(dto);
  }

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
