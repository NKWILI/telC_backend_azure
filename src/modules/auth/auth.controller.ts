import {
  Controller,
  Post,
  Body,
  BadRequestException,
  Patch,
  UseGuards,
  UnauthorizedException,
  HttpException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { RegisterRequestDto } from './dto/register-request.dto';
import { VerifyEmailRequestDto } from './dto/verify-email-request.dto';
import { AuthTokenResponse } from './dto/auth-response.dto';
import { RefreshRequestDto } from './dto/refresh-request.dto';
import { RefreshResponseDto } from './dto/refresh-response.dto';
import { ProfileUpdateDto } from './dto/profile-update.dto';
import { LogoutRequestDto } from './dto/logout-request.dto';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { CurrentStudent } from '../../shared/decorators/current-student.decorator';
import type { AccessTokenPayload } from '../../shared/interfaces/token-payload.interface';

interface StudentResponseDto {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  createdAt: string;
  updatedAt: string;
}

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
  ) {}

  /**
   * POST /api/auth/register
   * Register a new student account and send a verification email.
   */
  @Post('register')
  async register(@Body() dto: RegisterRequestDto): Promise<{ message: string }> {
    return this.authService.register(dto);
  }

  /**
   * POST /api/auth/verify-email
   * Verify a student's email and issue tokens.
   */
  @Post('verify-email')
  async verifyEmail(
    @Body() dto: VerifyEmailRequestDto,
  ): Promise<AuthTokenResponse> {
    return this.authService.verifyEmail(dto);
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
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      },
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
