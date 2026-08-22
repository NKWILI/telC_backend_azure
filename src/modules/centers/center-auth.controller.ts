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
  VerifyCenterEmailDto,
} from './dto/center-auth-request.dto';
import { CenterAuthResponseDto } from './dto/center-auth-response.dto';
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
}
