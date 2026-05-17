import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  BadGatewayException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../shared/services/prisma.service';
import { TokenService } from './token.service';
import { TokenCryptoService } from './token-crypto.service';
import { EmailService } from './email.service';
import { GoogleService } from './google.service';
import { Student } from '../../shared/interfaces/student.interface';
import { DeviceSession } from '../../shared/interfaces/device-session.interface';
import { AuthTokenResponse } from './dto/auth-response.dto';
import { RegisterRequestDto } from './dto/register-request.dto';
import { LoginRequestDto } from './dto/login-request.dto';
import { VerifyEmailRequestDto } from './dto/verify-email-request.dto';

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const VERIFICATION_RESEND_COOLDOWN_MS = 2 * 60 * 1000;

type VerificationStudentRecord = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  email_verified: boolean;
  email_verification_expires: Date | null;
  password_hash?: string | null;
  password_reset_expires?: Date | null;
};

type AuthStudentRecord = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly tokenCrypto: TokenCryptoService,
    private readonly emailService: EmailService,
    private readonly googleService: GoogleService,
  ) {}

  /**
   * Create device session
   * Creates a new device session for a student
   * Stores the hashed refresh token for validation
   */
  async createDeviceSession(
    studentId: string,
    deviceId: string,
    refreshTokenHash: string,
    deviceName?: string,
  ): Promise<DeviceSession> {
    return this.upsertDeviceSession(
      studentId,
      deviceId,
      refreshTokenHash,
      deviceName,
    );
  }

  async register(dto: RegisterRequestDto): Promise<{ message: string }> {
    const existingStudent = (await this.prisma.student.findUnique({
      where: { email: dto.email },
    })) as VerificationStudentRecord | null;

    if (existingStudent?.email_verified) {
      return { message: 'verification email sent' };
    }

    const rawToken = this.tokenCrypto.generateToken();
    const tokenHash = this.tokenCrypto.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);

    if (existingStudent) {
      if (
        existingStudent.email_verification_expires &&
        this.wasVerificationSentRecently(existingStudent.email_verification_expires)
      ) {
        return { message: 'verification email sent' };
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.student.update({
          where: { id: existingStudent.id },
          data: {
            email_verification_token: tokenHash,
            email_verification_expires: expiresAt,
          },
        });

        try {
          await this.emailService.sendVerificationEmail(dto.email, rawToken);
        } catch {
          throw new BadGatewayException('EMAIL_DELIVERY_FAILED');
        }
      });

      return { message: 'verification email sent' };
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    await this.prisma.$transaction(async (tx) => {
      await tx.student.create({
        data: {
          first_name: dto.firstName,
          last_name: dto.lastName,
          email: dto.email,
          password_hash: passwordHash,
          email_verified: false,
          email_verification_token: tokenHash,
          email_verification_expires: expiresAt,
        },
      });

      try {
        await this.emailService.sendVerificationEmail(dto.email, rawToken);
      } catch {
        throw new BadGatewayException('EMAIL_DELIVERY_FAILED');
      }
    });

    return { message: 'verification email sent' };
  }

  async login(dto: LoginRequestDto): Promise<AuthTokenResponse> {
    const student = (await this.prisma.student.findUnique({
      where: { email: dto.email },
      select: {
        id: true,
        password_hash: true,
        email_verified: true,
        email_verification_token: true,
        email_verification_expires: true,
        first_name: true,
        last_name: true,
        email: true,
      },
    })) as VerificationStudentRecord | null;

    if (!student) {
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }

    const isValid = student.password_hash
      ? await bcrypt.compare(dto.password, student.password_hash)
      : false;

    if (!isValid) {
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }

    if (!student.email_verified) {
      if (
        student.email_verification_expires &&
        this.wasVerificationSentRecently(student.email_verification_expires)
      ) {
        throw new ForbiddenException({
          error: 'EMAIL_NOT_VERIFIED',
          verified: false,
          message: 'Please verify your email to continue.',
        });
      }

      const rawToken = this.tokenCrypto.generateToken();
      const tokenHash = this.tokenCrypto.hashToken(rawToken);
      const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);

      await this.prisma.student.update({
        where: { id: student.id },
        data: {
          email_verification_token: tokenHash,
          email_verification_expires: expiresAt,
        },
      });

      this.emailService
        .sendVerificationEmail(student.email ?? '', rawToken)
        .catch((err: Error) =>
          this.logger.warn(
            `login: verification email delivery failed for ${student.email}: ${err.message}`,
          ),
        );

      throw new ForbiddenException({
        error: 'EMAIL_NOT_VERIFIED',
        verified: false,
        message: 'Please verify your email to continue.',
      });
    }

    return this.issueAuthResponse(student, dto.deviceId, dto.deviceName);
  }

  async verifyEmail(dto: VerifyEmailRequestDto): Promise<AuthTokenResponse> {
    const tokenHash = this.tokenCrypto.hashToken(dto.token);
    const student = (await this.prisma.student.findFirst({
      where: { email_verification_token: tokenHash },
    })) as VerificationStudentRecord | null;

    if (!student) {
      throw new BadRequestException('VERIFICATION_TOKEN_INVALID');
    }

    if (
      student.email_verification_expires &&
      this.tokenCrypto.isExpired(student.email_verification_expires)
    ) {
      throw new BadRequestException('VERIFICATION_TOKEN_EXPIRED');
    }

    if (!student.email_verified) {
      const updatedStudent = await this.prisma.student.update({
        where: { id: student.id },
        data: { email_verified: true },
      });

      return this.issueAuthResponse(updatedStudent, dto.deviceId, dto.deviceName);
    }

    return this.issueAuthResponse(student, dto.deviceId, dto.deviceName);
  }

  async verifyEmailPublic(token: string): Promise<{ verified: true }> {
    if (!token || typeof token !== 'string') {
      throw new BadRequestException('VERIFICATION_TOKEN_INVALID');
    }

    const tokenHash = this.tokenCrypto.hashToken(token);
    const student = (await this.prisma.student.findFirst({
      where: { email_verification_token: tokenHash },
    })) as VerificationStudentRecord | null;

    if (!student) {
      throw new BadRequestException('VERIFICATION_TOKEN_INVALID');
    }

    if (
      student.email_verification_expires &&
      this.tokenCrypto.isExpired(student.email_verification_expires)
    ) {
      throw new BadRequestException('VERIFICATION_TOKEN_EXPIRED');
    }

    if (!student.email_verified) {
      await this.prisma.student.update({
        where: { id: student.id },
        data: { email_verified: true },
      });
    }

    return { verified: true };
  }

  async forgotPassword(dto: import('./dto/forgot-password-request.dto').ForgotPasswordRequestDto): Promise<{ message: string }> {
    const GENERIC_RESPONSE = { message: 'If that email exists, a reset link was sent.' };

    const student = await this.prisma.student.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });

    if (!student) return GENERIC_RESPONSE;

    const rawToken = this.tokenCrypto.generateToken();
    const tokenHash = this.tokenCrypto.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS);

    await this.prisma.student.update({
      where: { id: student.id },
      data: {
        password_reset_token: tokenHash,
        password_reset_expires: expiresAt,
      },
    });

    try {
      await this.emailService.sendPasswordResetEmail(dto.email, rawToken);
    } catch (err) {
      this.logger.warn(
        `forgotPassword: email delivery failed for ${dto.email}: ${(err as Error).message}`,
      );
    }

    return GENERIC_RESPONSE;
  }

  async resetPassword(dto: import('./dto/reset-password-request.dto').ResetPasswordRequestDto): Promise<AuthTokenResponse> {
    const tokenHash = this.tokenCrypto.hashToken(dto.token);
    const student = await this.prisma.student.findFirst({
      where: { password_reset_token: tokenHash },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        email: true,
        password_reset_expires: true,
      } as any,
    }) as VerificationStudentRecord | null;

    if (!student) throw new BadRequestException('RESET_TOKEN_INVALID');

    if (student.password_reset_expires && this.tokenCrypto.isExpired(student.password_reset_expires)) {
      throw new BadRequestException('RESET_TOKEN_EXPIRED');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    // rotate password and remove tokens, revoke sessions, then issue a session
    await this.prisma.$transaction(async (tx) => {
      await tx.deviceSession.deleteMany({ where: { student_id: student.id } });
      await tx.student.update({
        where: { id: student.id },
        data: {
          password_hash: passwordHash,
          password_reset_token: null,
          password_reset_expires: null,
        },
      });
    });

    // issue tokens for the provided device
    return this.issueAuthResponse(student, dto.deviceId, dto.deviceName);
  }

  /**
   * Upsert device session
   * Ensures a maximum of 3 active sessions by evicting the oldest session
   * for new devices, then upserts by device_id in one transaction.
   */
  async upsertDeviceSession(
    studentId: string,
    deviceId: string,
    refreshTokenHash: string,
    deviceName?: string,
  ): Promise<DeviceSession> {
    if (!studentId?.trim() || !deviceId?.trim() || !refreshTokenHash?.trim()) {
      throw new BadRequestException('MISSING_REQUIRED_FIELDS');
    }

    try {
      const session = await this.prisma.$transaction(async (tx) => {
        const existingSession = await tx.deviceSession.findFirst({
          where: { student_id: studentId, device_id: deviceId, revoked_at: null },
          select: { id: true },
        });

        const activeCount = await tx.deviceSession.count({
          where: { student_id: studentId, revoked_at: null },
        });

        if (!existingSession && activeCount >= 3) {
          const oldestSession = await tx.deviceSession.findFirst({
            where: { student_id: studentId, revoked_at: null },
            orderBy: { created_at: 'asc' },
            select: { id: true },
          });

          if (oldestSession) {
            await tx.deviceSession.deleteMany({
              where: { id: { in: [oldestSession.id] } },
            });
          }
        }

        const upsertedSession = await tx.deviceSession.upsert({
          where: { device_id: deviceId },
          update: {
            student_id: studentId,
            device_name: deviceName?.trim() || null,
            refresh_token_hash: refreshTokenHash,
            revoked_at: null,
            last_used_at: new Date(),
          },
          create: {
            student_id: studentId,
            device_id: deviceId,
            device_name: deviceName?.trim() || null,
            refresh_token_hash: refreshTokenHash,
          },
        });

        return upsertedSession as unknown as DeviceSession;
      });

      return session;
    } catch (error) {
      throw new BadRequestException('DEVICE_SESSION_CREATION_FAILED');
    }
  }

  private wasVerificationSentRecently(expiresAt: Date): boolean {
    const sentAt = expiresAt.getTime() - VERIFICATION_TOKEN_TTL_MS;
    return Date.now() - sentAt < VERIFICATION_RESEND_COOLDOWN_MS;
  }

  private async issueAuthResponse(
    student: AuthStudentRecord,
    deviceId: string,
    deviceName?: string,
  ): Promise<AuthTokenResponse> {
    const tokens = await this.issueTokenPairForDevice(
      student.id,
      deviceId,
      deviceName,
    );

    await this.updateStudentLastSeen(student.id);

    return {
      ...tokens,
      student: {
        id: student.id,
        firstName: student.first_name,
        lastName: student.last_name,
        email: student.email ?? '',
        emailVerified: true,
      },
    };
  }

  private async issueTokenPairForDevice(
    studentId: string,
    deviceId: string,
    deviceName?: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const provisionalToken = this.tokenCrypto.generateToken();
    const provisionalHash = this.tokenCrypto.hashToken(provisionalToken);

    const session = await this.upsertDeviceSession(
      studentId,
      deviceId,
      provisionalHash,
      deviceName,
    );

    const tokens = this.tokenService.generateTokenPair({
      studentId,
      deviceId,
      sessionId: session.id,
    });

    const refreshHash = await this.tokenService.hashRefreshToken(
      tokens.refreshToken,
    );
    await this.updateDeviceSessionRefreshHash(session.id, refreshHash);

    return tokens;
  }

  /**
   * Validate refresh token
   * Validates that a device session exists and is not revoked
   * Updates the last_used_at timestamp
   */
  async validateRefreshToken(
    sessionId: string,
    studentId: string,
  ): Promise<DeviceSession> {
    if (!sessionId?.trim() || !studentId?.trim()) {
      throw new UnauthorizedException('INVALID_SESSION');
    }

    try {
      const session = await this.prisma.deviceSession.findFirst({
        where: { id: sessionId, student_id: studentId },
      });

      if (!session) {
        throw new UnauthorizedException('INVALID_SESSION');
      }

      if (session.revoked_at !== null) {
        throw new UnauthorizedException('SESSION_REVOKED');
      }

      await this.prisma.deviceSession.update({
        where: { id: sessionId },
        data: { last_used_at: new Date() },
      });

      return session as unknown as DeviceSession;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('INVALID_SESSION');
    }
  }

  /**
   * Fetch a student by id
   */
  async getStudentById(studentId: string): Promise<Student> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
    });

    if (!student) {
      throw new BadRequestException('STUDENT_NOT_FOUND');
    }

    return student as unknown as Student;
  }

  /**
   * Update student profile details
   */
  async updateStudentProfile(
    studentId: string,
    updates: { firstName?: string; lastName?: string; email?: string },
  ): Promise<Student> {
    const data: {
      first_name?: string;
      last_name?: string;
      email?: string;
      updated_at: Date;
    } = { updated_at: new Date() };

    if (updates.firstName?.trim()) data.first_name = updates.firstName.trim();
    if (updates.lastName?.trim()) data.last_name = updates.lastName.trim();
    if (updates.email?.trim()) data.email = updates.email.trim().toLowerCase();

    try {
      const student = await this.prisma.student.update({
        where: { id: studentId },
        data,
      });
      return student as unknown as Student;
    } catch {
      throw new BadRequestException('PROFILE_UPDATE_FAILED');
    }
  }

  /**
   * Update a device session refresh token hash
   */
  async updateDeviceSessionRefreshHash(
    sessionId: string,
    refreshTokenHash: string,
  ): Promise<void> {
    try {
      await this.prisma.deviceSession.update({
        where: { id: sessionId },
        data: {
          refresh_token_hash: refreshTokenHash,
          last_used_at: new Date(),
        },
      });
    } catch {
      throw new BadRequestException('SESSION_UPDATE_FAILED');
    }
  }

  /**
   * Revoke a device session
   */
  async revokeDeviceSession(sessionId: string): Promise<void> {
    try {
      await this.prisma.deviceSession.update({
        where: { id: sessionId },
        data: { revoked_at: new Date() },
      });
    } catch {
      throw new BadRequestException('SESSION_REVOKE_FAILED');
    }
  }

  async updateStudentLastSeen(studentId: string): Promise<void> {
    await this.prisma.student.update({
      where: { id: studentId },
      data: { last_seen_at: new Date() },
    });
  }

  async getDeviceSessions(studentId: string): Promise<{
    id: string;
    device_id: string;
    device_name: string | null;
    last_used_at: Date;
    created_at: Date;
  }[]> {
    return this.prisma.deviceSession.findMany({
      where: { student_id: studentId, revoked_at: null },
      orderBy: { last_used_at: 'desc' },
      select: { id: true, device_id: true, device_name: true, last_used_at: true, created_at: true },
    }) as any;
  }

  /**
   * Get active device session for a student and device
   * Used when rotating tokens without creating new session
   */
  async getActiveDeviceSession(
    studentId: string,
    deviceId: string,
  ): Promise<DeviceSession> {
    const session = await this.prisma.deviceSession.findFirst({
      where: { student_id: studentId, device_id: deviceId, revoked_at: null },
      orderBy: { created_at: 'desc' },
    });

    if (!session) {
      throw new UnauthorizedException('NO_ACTIVE_SESSION');
    }

    return session as unknown as DeviceSession;
  }

  /**
   * Google OAuth Login
   * Handles returning users, new users, and accounts awaiting linking
   */
  async googleLogin(dto: { idToken: string; deviceId: string; deviceName?: string }): Promise<AuthTokenResponse | { status: 'LINKING_REQUIRED'; linkingToken: string }> {
    const googlePayload = await this.googleService.verifyIdToken(dto.idToken);

    // Check for returning user (existing OAuthAccount)
    const oauthAccount = await this.prisma.oAuthAccount.findFirst({
      where: {
        provider: 'google',
        provider_id: googlePayload.sub,
      },
      include: { student: true },
    });

    if (oauthAccount) {
      const student = oauthAccount.student as VerificationStudentRecord;
      return this.issueAuthResponse(student, dto.deviceId, dto.deviceName);
    }

    // Check if email exists
    const existingStudent = await this.prisma.student.findUnique({
      where: { email: googlePayload.email },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        email: true,
        email_verified: true,
      } as any,
    }) as VerificationStudentRecord | null;

    if (existingStudent) {
      // Email exists but no OAuth link → require linking
      const linkingToken = this.tokenService.generateLinkingToken({
        email: googlePayload.email,
        provider: 'google',
        providerId: googlePayload.sub,
      });
      return { status: 'LINKING_REQUIRED', linkingToken };
    }

    // Brand new user → create student + oauth account + issue tokens
    const newStudent = await this.prisma.$transaction(async (tx) => {
      const student = await tx.student.create({
        data: {
          first_name: googlePayload.given_name || null,
          last_name: googlePayload.family_name || null,
          email: googlePayload.email,
          email_verified: googlePayload.email_verified,
          password_hash: null,
        },
      });

      await tx.oAuthAccount.create({
        data: {
          student_id: student.id,
          provider: 'google',
          provider_id: googlePayload.sub,
        },
      });

      return student;
    });

    return this.issueAuthResponse(
      {
        id: newStudent.id,
        first_name: newStudent.first_name,
        last_name: newStudent.last_name,
        email: newStudent.email,
      } as VerificationStudentRecord,
      dto.deviceId,
      dto.deviceName,
    );
  }

  /**
   * Link Google account to existing student
   * Consumes a linking token and creates OAuthAccount
   */
  async googleLink(dto: { linkingToken: string; deviceId: string; deviceName?: string }): Promise<AuthTokenResponse> {
    const linkingPayload = this.tokenService.verifyLinkingToken(dto.linkingToken);

    // Find student by email
    const student = await this.prisma.student.findUnique({
      where: { email: linkingPayload.email },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        email: true,
      } as any,
    }) as VerificationStudentRecord | null;

    if (!student) {
      throw new BadRequestException('STUDENT_NOT_FOUND');
    }

    // Create OAuth account and mark email verified
    await this.prisma.$transaction(async (tx) => {
      await tx.oAuthAccount.create({
        data: {
          student_id: student.id,
          provider: linkingPayload.provider,
          provider_id: linkingPayload.providerId,
        },
      });

      await tx.student.update({
        where: { id: student.id },
        data: { email_verified: true },
      });
    });

    // Issue tokens
    return this.issueAuthResponse(student, dto.deviceId, dto.deviceName);
  }
}
