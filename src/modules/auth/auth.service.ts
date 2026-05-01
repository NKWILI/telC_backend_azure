import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  BadGatewayException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../shared/services/prisma.service';
import { TokenService } from './token.service';
import { TokenCryptoService } from './token-crypto.service';
import { EmailService } from './email.service';
import { Student } from '../../shared/interfaces/student.interface';
import { DeviceSession } from '../../shared/interfaces/device-session.interface';
import { AuthTokenResponse } from './dto/auth-response.dto';
import { RegisterRequestDto } from './dto/register-request.dto';
import { VerifyEmailRequestDto } from './dto/verify-email-request.dto';

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const VERIFICATION_RESEND_COOLDOWN_MS = 2 * 60 * 1000;

type VerificationStudentRecord = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  email_verified: boolean;
  email_verification_expires: Date | null;
};

type AuthStudentRecord = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly tokenCrypto: TokenCryptoService,
    private readonly emailService: EmailService,
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

  async verifyEmail(dto: VerifyEmailRequestDto): Promise<AuthTokenResponse> {
    const tokenHash = this.tokenCrypto.hashToken(dto.token);
    const student = (await this.prisma.student.findFirst({
      where: { email_verification_token: tokenHash },
    })) as VerificationStudentRecord | null;

    if (!student) {
      throw new BadRequestException('VERIFICATION_TOKEN_INVALID');
    }

    if (!student.email_verified) {
      if (
        student.email_verification_expires &&
        this.tokenCrypto.isExpired(student.email_verification_expires)
      ) {
        throw new BadRequestException('VERIFICATION_TOKEN_EXPIRED');
      }

      const updatedStudent = await this.prisma.student.update({
        where: { id: student.id },
        data: {
          email_verified: true,
          email_verification_token: null,
          email_verification_expires: null,
        },
      });

      return this.issueAuthResponse(updatedStudent, dto.deviceId, dto.deviceName);
    }

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
}
