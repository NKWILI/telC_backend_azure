import {
  Controller,
  Post,
  Get,
  Body,
  BadRequestException,
  Patch,
  UseGuards,
  UnauthorizedException,
  HttpException,
  Ip,
  Delete,
  Param,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { RateLimitService } from '../../shared/services/rate-limit.service';
import { RegisterRequestDto } from './dto/register-request.dto';
import { LoginRequestDto } from './dto/login-request.dto';
import { VerifyEmailRequestDto } from './dto/verify-email-request.dto';
import { VerifyEmailPublicRequestDto } from './dto/verify-email-public-request.dto';
import { ForgotPasswordRequestDto } from './dto/forgot-password-request.dto';
import { ResetPasswordRequestDto } from './dto/reset-password-request.dto';
import { GoogleLoginRequestDto } from './dto/google-login-request.dto';
import { GoogleLinkRequestDto } from './dto/google-link-request.dto';
import { AuthTokenResponse } from './dto/auth-response.dto';
import { RefreshRequestDto } from './dto/refresh-request.dto';
import { RefreshResponseDto } from './dto/refresh-response.dto';
import { ProfileUpdateDto } from './dto/profile-update.dto';
import { LogoutRequestDto } from './dto/logout-request.dto';
import { GuestSessionResponseDto } from './dto/guest-session-response.dto';
import * as crypto from 'crypto';
import {
  ApiTags,
  ApiOperation,
  ApiCreatedResponse,
  ApiTooManyRequestsResponse,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiServiceUnavailableResponse,
  getSchemaPath,
  ApiExtraModels,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { CurrentStudent } from '../../shared/decorators/current-student.decorator';
import type { AccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import {
  AuthErrorResponseDto,
  AuthStudentDto,
  AuthTokenResponseDto,
  DeviceSessionResponseDto,
  GoogleLinkingRequiredDto,
  MessageResponseDto,
  SuccessResponseDto,
  VerifiedResponseDto,
} from './dto/auth-swagger-response.dto';

interface StudentResponseDto {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  emailVerified: boolean;
}

@ApiTags('Auth')
@ApiExtraModels(
  AuthTokenResponseDto,
  AuthStudentDto,
  RefreshResponseDto,
  GoogleLinkingRequiredDto,
)
@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
    private readonly rateLimitService: RateLimitService,
  ) {}

  /**
   * POST /api/auth/register
   * Register a new student account and send a verification email.
   */
  @Post('register')
  @ApiOperation({
    summary: 'Register with email and password',
    description:
      'Creates an unverified account and sends a branded Lerniqo verification email. The response is intentionally generic for both new and existing addresses to prevent account enumeration.',
  })
  @ApiCreatedResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({
    type: AuthErrorResponseDto,
    description: 'Invalid request body.',
  })
  @ApiTooManyRequestsResponse({
    description:
      'Too many registration attempts for this address or from this IP (RATE_LIMIT_EXCEEDED). ' +
      'Default: 5 per address per hour, 20 per IP per hour.',
  })
  async register(
    @Ip() ip: string,
    @Body() dto: RegisterRequestDto,
  ): Promise<{ message: string }> {
    // Before the service, not after. Registering an address that already has an
    // unverified account rotates its verification token, killing the link
    // already sitting in the real owner's inbox — so the write is the thing
    // being abused and must not happen on a rejected request.
    await this.rateLimitService.checkRegisterLimit(ip || 'unknown', dto.email);
    return this.authService.register(dto);
  }

  /**
   * POST /api/auth/verify-email
   * Verify a student's email and issue tokens.
   */
  @Post('verify-email')
  @ApiOperation({
    summary: 'Verify an email and start a device session',
    description:
      'Consumes the one-time email token and returns an access/refresh token pair bound to deviceId. Repeating a successful verification is idempotent while the token remains valid.',
  })
  @ApiCreatedResponse({ type: AuthTokenResponseDto })
  @ApiBadRequestResponse({
    type: AuthErrorResponseDto,
    description: 'Verification token is invalid or expired.',
  })
  async verifyEmail(
    @Body() dto: VerifyEmailRequestDto,
  ): Promise<AuthTokenResponse> {
    return this.authService.verifyEmail(dto);
  }

  /**
   * POST /api/auth/verify-email-public
   * Public endpoint for the marketing-site verify-email page.
   * Flips email_verified=true. No JWT, no device session.
   */
  @Post('verify-email-public')
  @ApiOperation({
    summary: 'Verify an email without creating a session',
    description:
      'Used by the public website verification page. It creates no JWT or device session.',
  })
  @ApiCreatedResponse({ type: VerifiedResponseDto })
  @ApiBadRequestResponse({ type: AuthErrorResponseDto })
  @ApiTooManyRequestsResponse({ type: AuthErrorResponseDto })
  async verifyEmailPublic(
    @Body() dto: VerifyEmailPublicRequestDto,
    @Ip() ip: string,
  ): Promise<{ verified: true }> {
    await this.rateLimitService.checkVerifyEmailPublicLimit(ip || 'unknown');
    return this.authService.verifyEmailPublic(dto.token);
  }

  /**
   * POST /api/auth/forgot-password
   */
  @Post('forgot-password')
  @ApiOperation({
    summary: 'Request a password-recovery email',
    description:
      'Always returns the same success response, even when the email is unknown, to prevent account discovery. A valid account receives a one-time recovery link.',
  })
  @ApiCreatedResponse({ type: MessageResponseDto })
  @ApiTooManyRequestsResponse({ type: AuthErrorResponseDto })
  async forgotPassword(
    @Body() dto: ForgotPasswordRequestDto,
    @Ip() ip: string,
  ): Promise<{ message: string }> {
    await this.rateLimitService.checkForgotPasswordLimit(ip || 'unknown');
    return this.authService.forgotPassword(dto);
  }

  /**
   * POST /api/auth/reset-password
   */
  @Post('reset-password')
  @ApiOperation({
    summary: 'Reset the password and start a device session',
    description:
      'Consumes the one-time recovery token, changes the password, invalidates existing sessions, and returns a fresh access/refresh token pair for this device.',
  })
  @ApiCreatedResponse({ type: AuthTokenResponseDto })
  @ApiBadRequestResponse({
    type: AuthErrorResponseDto,
    description: 'Reset token is invalid, expired, or already used.',
  })
  @ApiTooManyRequestsResponse({ type: AuthErrorResponseDto })
  async resetPassword(
    @Body() dto: ResetPasswordRequestDto,
    @Ip() ip: string,
  ): Promise<AuthTokenResponse> {
    await this.rateLimitService.checkResetPasswordLimit(ip || 'unknown');
    return this.authService.resetPassword(dto);
  }

  /**
   * POST /api/auth/login
   * Login with email and password and issue tokens
   */
  @Post('login')
  @ApiOperation({
    summary: 'Log in with email and password',
    description:
      'Creates or replaces the session for this student and deviceId. Use accessToken as a Bearer token and store refreshToken securely for rotation.',
  })
  @ApiCreatedResponse({ type: AuthTokenResponseDto })
  @ApiUnauthorizedResponse({
    type: AuthErrorResponseDto,
    description: 'Credentials are invalid.',
  })
  @ApiForbiddenResponse({
    type: AuthErrorResponseDto,
    description: 'Email is not verified or membership has expired.',
  })
  @ApiTooManyRequestsResponse({ type: AuthErrorResponseDto })
  async login(
    @Body() dto: LoginRequestDto,
    @Ip() ip: string,
  ): Promise<AuthTokenResponse> {
    await this.rateLimitService.checkLoginLimit(ip || 'unknown', dto.email);
    return this.authService.login(dto);
  }

  /**
   * POST /api/auth/guest
   * Issue a short-lived (2h) guest JWT for demo / waitlist visitors.
   * No credentials required. No DB row created. Rate-limited per IP.
   * The token carries isGuest=true so downstream guards can block guests from
   * cost-sensitive endpoints (Speaking) and apply tighter rate limits.
   */
  @Post('guest')
  @ApiOperation({
    summary: 'Create an anonymous guest session for the demo / waitlist flow',
    description:
      'Issues a short-lived (2h) guest JWT with no credentials and no DB row. ' +
      'The token carries isGuest=true: it can access Writing, Reading, ' +
      'Sprachbausteine and Listening, but Speaking returns 403 (messageKey ' +
      'guestNotAllowed) and Writing submissions are capped at 3 per IP per hour. ' +
      'Rate-limited to 10 guest sessions per IP per hour.',
  })
  @ApiCreatedResponse({ type: GuestSessionResponseDto })
  @ApiTooManyRequestsResponse({
    description: 'Too many guest sessions from this IP (RATE_LIMIT_EXCEEDED)',
  })
  async createGuestSession(@Ip() ip: string): Promise<GuestSessionResponseDto> {
    await this.rateLimitService.checkGuestSessionLimit(ip || 'unknown');
    const studentId = crypto.randomUUID();
    const accessToken = this.tokenService.generateGuestAccessToken({
      studentId,
    });
    return { accessToken, isGuest: true, expiresIn: 7200 };
  }

  /**
   * POST /api/auth/refresh
   * Refresh access and refresh tokens
   */
  @Post('refresh')
  @ApiOperation({
    summary: 'Rotate a refresh token and obtain a new token pair',
    description:
      'Refresh tokens are single-use. On success, atomically replace the stored refresh token with the returned one. Concurrent or repeated use of the old token returns 401 and must not overwrite the newer client tokens.',
  })
  @ApiCreatedResponse({ type: RefreshResponseDto })
  @ApiUnauthorizedResponse({
    type: AuthErrorResponseDto,
    description: 'Token is invalid, expired, revoked, or already rotated.',
  })
  @ApiForbiddenResponse({
    type: AuthErrorResponseDto,
    description: 'Membership has expired.',
  })
  async refresh(
    @Body() refreshDto: RefreshRequestDto,
  ): Promise<RefreshResponseDto> {
    try {
      const refreshPayload = this.tokenService.verifyRefreshToken(
        refreshDto.refreshToken,
      );

      const session = await this.authService.validateRefreshToken(
        refreshPayload.sessionId,
        refreshPayload.studentId,
      );

      if (session.device_id !== refreshPayload.deviceId) {
        throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
      }

      const isMatch = await this.tokenService.compareRefreshToken(
        refreshDto.refreshToken,
        session.refresh_token_hash,
      );

      if (!isMatch) {
        throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
      }

      const tokens = this.tokenService.generateTokenPair({
        studentId: refreshPayload.studentId,
        deviceId: refreshPayload.deviceId,
        sessionId: refreshPayload.sessionId,
      });

      const newRefreshHash = await this.tokenService.hashRefreshToken(
        tokens.refreshToken,
      );

      const rotated = await this.authService.rotateDeviceSessionRefreshHash(
        refreshPayload.sessionId,
        session.refresh_token_hash,
        newRefreshHash,
      );
      if (!rotated) {
        throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
      }

      await this.authService.updateStudentLastSeen(refreshPayload.studentId);

      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
    }
  }

  /**
   * PATCH /api/auth/profile
   * Update student profile
   */
  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update the authenticated student profile and rotate tokens',
  })
  @ApiOkResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(RefreshResponseDto) },
        {
          type: 'object',
          properties: { student: { $ref: getSchemaPath(AuthStudentDto) } },
        },
      ],
    },
  })
  @ApiBadRequestResponse({
    type: AuthErrorResponseDto,
    description: 'No profile fields or invalid values.',
  })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiServiceUnavailableResponse({
    type: AuthErrorResponseDto,
    description: 'Session validity cannot be established safely.',
  })
  async updateProfile(
    @CurrentStudent() student: AccessTokenPayload,
    @Body() profileDto: ProfileUpdateDto,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    student: StudentResponseDto;
  }> {
    if (!profileDto.firstName && !profileDto.lastName && !profileDto.email) {
      throw new BadRequestException('NO_PROFILE_FIELDS');
    }

    const updated = await this.authService.updateStudentProfile(
      student.studentId,
      {
        firstName: profileDto.firstName,
        lastName: profileDto.lastName,
        email: profileDto.email,
      },
    );

    const activeSession = await this.authService.getActiveDeviceSession(
      student.studentId,
      student.deviceId,
    );

    const tokens = this.tokenService.generateTokenPair({
      studentId: updated.id,
      deviceId: student.deviceId,
      sessionId: activeSession.id,
    });

    const newRefreshHash = await this.tokenService.hashRefreshToken(
      tokens.refreshToken,
    );
    await this.authService.updateDeviceSessionRefreshHash(
      activeSession.id,
      newRefreshHash,
    );

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      student: {
        id: updated.id,
        firstName: updated.first_name,
        lastName: updated.last_name,
        email: updated.email,
        emailVerified: updated.email_verified,
      },
    };
  }

  /**
   * POST /api/auth/logout
   * Revoke the device session tied to the refresh token
   */
  @Post('logout')
  @ApiOperation({
    summary: 'Log out one device session',
    description:
      'Revokes the session identified by the refresh token. Its refresh token is rejected immediately, and its access token is rejected by protected endpoints from the next request.',
  })
  @ApiCreatedResponse({ type: SuccessResponseDto })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  async logout(
    @Body() logoutDto: LogoutRequestDto,
  ): Promise<{ success: true }> {
    try {
      const refreshPayload = this.tokenService.verifyRefreshToken(
        logoutDto.refreshToken,
      );

      const session = await this.authService.validateRefreshToken(
        refreshPayload.sessionId,
        refreshPayload.studentId,
      );

      if (session.device_id !== refreshPayload.deviceId) {
        throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
      }

      const isMatch = await this.tokenService.compareRefreshToken(
        logoutDto.refreshToken,
        session.refresh_token_hash,
      );

      if (!isMatch) {
        throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
      }

      await this.authService.revokeDeviceSession(refreshPayload.sessionId);
      await this.authService.updateStudentLastSeen(refreshPayload.studentId);
      return { success: true };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
    }
  }

  /**
   * GET /api/auth/device-sessions
   * List active device sessions for the authenticated student
   */
  @UseGuards(JwtAuthGuard)
  @Get('device-sessions')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List active device sessions for the authenticated student',
  })
  @ApiOkResponse({ type: DeviceSessionResponseDto, isArray: true })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: AuthErrorResponseDto })
  async getDeviceSessions(@CurrentStudent() student: AccessTokenPayload) {
    return this.authService.getDeviceSessions(student.studentId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('device-sessions/:sessionId')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Revoke one of the authenticated student’s device sessions',
    description:
      'The session must belong to the authenticated student. Revocation takes effect immediately.',
  })
  @ApiOkResponse({ type: SuccessResponseDto })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiNotFoundResponse({
    type: AuthErrorResponseDto,
    description: 'Session does not exist or belongs to another student.',
  })
  async revokeDeviceSession(
    @CurrentStudent() student: AccessTokenPayload,
    @Param('sessionId') sessionId: string,
  ): Promise<{ success: true }> {
    await this.authService.revokeStudentDeviceSession(
      student.studentId,
      sessionId,
    );
    return { success: true };
  }

  /**
   * POST /api/auth/google
   * Login or request linking with Google OAuth
   */
  @Post('google')
  @ApiOperation({
    summary: 'Google login (currently disabled)',
    deprecated: true,
  })
  @ApiCreatedResponse({
    description: 'Legacy response; this integration is currently not in use.',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(AuthTokenResponseDto) },
        { $ref: getSchemaPath(GoogleLinkingRequiredDto) },
      ],
    },
  })
  async googleLogin(
    @Body() dto: GoogleLoginRequestDto,
  ): Promise<
    AuthTokenResponse | { status: 'LINKING_REQUIRED'; linkingToken: string }
  > {
    return this.authService.googleLogin(dto);
  }

  /**
   * POST /api/auth/google/link
   * Link Google account to existing student
   */
  @Post('google/link')
  @ApiOperation({
    summary: 'Link a Google account (currently disabled)',
    deprecated: true,
  })
  @ApiCreatedResponse({ type: AuthTokenResponseDto })
  async googleLink(
    @Body() dto: GoogleLinkRequestDto,
  ): Promise<AuthTokenResponse> {
    return this.authService.googleLink(dto);
  }
}
