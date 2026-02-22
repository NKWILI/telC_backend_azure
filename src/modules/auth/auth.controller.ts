import {
  Controller,
  Post,
  Body,
  BadRequestException,
  Patch,
  UseGuards,
  UnauthorizedException,
  Req,
  HttpException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { ActivateRequestDto } from './dto/activate-request.dto';
import {
  ActivateResponseDto,
  StudentResponseDto,
} from './dto/activate-response.dto';
import { LoginWithCodeRequestDto } from './dto/login-with-code-request.dto';
import { RefreshRequestDto } from './dto/refresh-request.dto';
import { RefreshResponseDto } from './dto/refresh-response.dto';
import { ProfileUpdateDto } from './dto/profile-update.dto';
import { LogoutRequestDto } from './dto/logout-request.dto';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { CurrentStudent } from '../../shared/decorators/current-student.decorator';
import type { AccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { RateLimitService } from '../../shared/services/rate-limit.service';

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
    private readonly rateLimitService: RateLimitService,
  ) {}

  /**
   * POST /api/auth/activate
   * Activates a student account with personal information
   * Returns: {accessToken, refreshToken, student}
   */
  @Post('activate')
  async activate(
    @Req() request: Request,
    @Body() activateDto: ActivateRequestDto,
  ): Promise<ActivateResponseDto> {
    try {
      const forwarded = request.headers['x-forwarded-for'];
      const ip = Array.isArray(forwarded)
        ? forwarded[0]
        : forwarded?.split(',')[0]?.trim() || request.ip || 'unknown';
      this.rateLimitService.checkActivationLimit(ip);

      const student = await this.authService.createStudent(
        activateDto.activationCode,
        activateDto.firstName,
        activateDto.lastName,
        activateDto.email,
      );

      const deviceId = activateDto.deviceId;
      const sessionId = randomUUID();

      const tokenPair = this.tokenService.generateTokenPair({
        studentId: student.id,
        isRegistered: student.is_registered,
        deviceId,
        sessionId,
      });

      const refreshTokenHash = await this.tokenService.hashRefreshToken(
        tokenPair.refreshToken,
      );

      await this.authService.createDeviceSession(
        student.id,
        deviceId,
        refreshTokenHash,
        'Unknown Device',
      );

      const expiresAt = await this.authService.getActivationCodeExpiry(
        activateDto.activationCode,
      );

      return {
        accessToken: tokenPair.accessToken,
        refreshToken: tokenPair.refreshToken,
        student: {
          id: student.id,
          firstName: student.first_name,
          lastName: student.last_name,
          email: student.email,
          isRegistered: student.is_registered,
          createdAt: student.created_at,
          updatedAt: student.updated_at,
        } as StudentResponseDto,
        bootstrap: {
          availableModules: ['SPRECHEN', 'LESEN', 'HOEREN', 'SCHREIBEN'],
          enabledModules: ['SPRECHEN', 'LESEN'],
          progressSummary: {},
          lastActivityAt: null,
          expiresAt,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException(error?.message || 'ACTIVATION_FAILED');
    }
  }

  /**
   * POST /api/auth/login-with-code
   * For dev / returning users: get tokens with an already-claimed activation code.
   */
  @Post('login-with-code')
  async loginWithCode(
    @Body() dto: LoginWithCodeRequestDto,
  ): Promise<ActivateResponseDto> {
    const { student, expiresAt } =
      await this.authService.loginWithActivationCode(dto.activationCode);

    const deviceId = dto.deviceId;
    const sessionId = randomUUID();
    const tokenPair = this.tokenService.generateTokenPair({
      studentId: student.id,
      isRegistered: student.is_registered,
      deviceId,
      sessionId,
    });
    const refreshTokenHash =
      await this.tokenService.hashRefreshToken(tokenPair.refreshToken);
    await this.authService.createDeviceSession(
      student.id,
      deviceId,
      refreshTokenHash,
      'Unknown Device',
    );

    return {
      accessToken: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
      student: {
        id: student.id,
        firstName: student.first_name,
        lastName: student.last_name,
        email: student.email,
        isRegistered: student.is_registered,
        createdAt: student.created_at,
        updatedAt: student.updated_at,
      } as StudentResponseDto,
      bootstrap: {
        availableModules: ['SPRECHEN', 'LESEN', 'HOEREN', 'SCHREIBEN'],
        enabledModules: ['SPRECHEN', 'LESEN'],
        progressSummary: {},
        lastActivityAt: null,
        expiresAt,
      },
    };
  }

  /**
   * POST /api/auth/refresh
   * Refresh access and refresh tokens
   */
  @Post('refresh')
  async refresh(
    @Body() refreshDto: RefreshRequestDto,
  ): Promise<RefreshResponseDto> {
    try {
      const refreshPayload = this.tokenService.verifyRefreshToken(
        refreshDto.refreshToken,
      );

      // Check membership expiry before issuing new tokens
      await this.authService.checkMembershipExpiry(refreshPayload.studentId);

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
        isRegistered: true,
        deviceId: refreshPayload.deviceId,
        sessionId: refreshPayload.sessionId,
      });

      const newRefreshHash = await this.tokenService.hashRefreshToken(
        tokens.refreshToken,
      );

      await this.authService.updateDeviceSessionRefreshHash(
        refreshPayload.sessionId,
        newRefreshHash,
      );

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

    // Get existing active device session to reuse its sessionId
    const activeSession = await this.authService.getActiveDeviceSession(
      student.studentId,
      student.deviceId,
    );

    // Generate new tokens with updated is_registered claim and existing sessionId
    const tokens = this.tokenService.generateTokenPair({
      studentId: updated.id,
      isRegistered: updated.is_registered,
      deviceId: student.deviceId,
      sessionId: activeSession.id,
    });

    // Update the session's refresh token hash (token rotation)
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
        isRegistered: updated.is_registered,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      } as StudentResponseDto,
    };
  }

  /**
   * POST /api/auth/logout
   * Revoke the device session tied to the refresh token
   */
  @Post('logout')
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
      return { success: true };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
    }
  }
}
