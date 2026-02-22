import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from '../../shared/services/database.service';
import { TokenService } from './token.service';
import { Student } from '../../shared/interfaces/student.interface';
import { DeviceSession } from '../../shared/interfaces/device-session.interface';

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tokenService: TokenService,
  ) {}

  /**
   * Validate activation code and return associated student (if any).
   * - status 'available': first-time activation, returns null student
   * - status 'active': returning user, returns existing student
   * - any other status: throws
   */
  async validateActivationCode(
    code: string,
  ): Promise<{ student: Student | null; activationCodeId: string }> {
    if (!code || code.trim().length === 0) {
      throw new BadRequestException('INVALID_ACTIVATION_CODE');
    }

    try {
      const { data: acData, error: acError } = await this.db
        .getClient()
        .from('activation_codes')
        .select('code, student_id, status, expires_at')
        .eq('code', code.trim())
        .single();

      if (acError || !acData) {
        throw new BadRequestException('INVALID_ACTIVATION_CODE');
      }

      if (acData.status === 'available') {
        // First-time activation — no student yet
        return { student: null, activationCodeId: acData.code };
      }

      if (acData.status === 'active') {
        // Returning user — check expiry
        if (acData.expires_at && new Date(acData.expires_at) < new Date()) {
          throw new ForbiddenException('MEMBERSHIP_EXPIRED');
        }

        const { data: student, error: studentError } = await this.db
          .getClient()
          .from('students')
          .select('*')
          .eq('id', acData.student_id)
          .single();

        if (studentError || !student) {
          throw new BadRequestException('STUDENT_NOT_FOUND');
        }

        return { student: student as Student, activationCodeId: acData.code };
      }

      // Any other status (used, revoked, etc.)
      throw new BadRequestException('ACTIVATION_CODE_ALREADY_USED');
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw new BadRequestException('INVALID_ACTIVATION_CODE');
    }
  }

  /**
   * Activate a student account.
   * - First-time: creates student record, claims activation code (30-day expiry)
   * - Returning: throws if already registered
   * Always sets profile fields and is_registered = true.
   */
  async createStudent(
    activationCode: string,
    firstName: string,
    lastName: string,
    email: string,
  ): Promise<Student> {
    if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
      throw new BadRequestException('MISSING_REQUIRED_FIELDS');
    }

    try {
      const { student, activationCodeId } =
        await this.validateActivationCode(activationCode);

      const now = new Date().toISOString();

      if (!student) {
        // First-time activation: create student, claim code
        const { data: newStudent, error: insertError } = await this.db
          .getClient()
          .from('students')
          .insert({
            activation_code: activationCode.trim(),
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            email: email.trim().toLowerCase(),
            is_registered: true,
            created_at: now,
            updated_at: now,
          })
          .select()
          .single();

        if (insertError || !newStudent) {
          throw new Error('Failed to create student');
        }

        // Claim the activation code: set status, expiry, link student
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        await this.db
          .getClient()
          .from('activation_codes')
          .update({
            status: 'active',
            claimed_at: now,
            expires_at: expiresAt.toISOString(),
            student_id: newStudent.id,
          })
          .eq('code', activationCodeId);

        return newStudent as Student;
      }

      // Returning user — already registered
      if (student.is_registered) {
        throw new ConflictException('STUDENT_ALREADY_REGISTERED');
      }

      // Edge case: code was active but student not yet registered
      const { data: updatedStudent, error: updateError } = await this.db
        .getClient()
        .from('students')
        .update({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim().toLowerCase(),
          is_registered: true,
          updated_at: now,
        })
        .eq('id', student.id)
        .select()
        .single();

      if (updateError || !updatedStudent) {
        throw new Error('Failed to update student');
      }

      return updatedStudent as Student;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw new BadRequestException('REGISTRATION_FAILED');
    }
  }

  /**
   * Login with an already-claimed activation code (for dev / returning users).
   * Code must be status 'active' with a student. Returns the student and expiry.
   */
  async loginWithActivationCode(
    activationCode: string,
  ): Promise<{ student: Student; expiresAt: string }> {
    const { student } = await this.validateActivationCode(activationCode);
    if (!student) {
      throw new BadRequestException('INVALID_ACTIVATION_CODE');
    }
    const expiresAt = await this.getActivationCodeExpiry(activationCode);
    return { student, expiresAt };
  }

  /**
   * Step 11: Create device session
   * Creates a new device session for a student
   * Stores the hashed refresh token for validation
   */
  async createDeviceSession(
    studentId: string,
    deviceId: string,
    refreshTokenHash: string,
    deviceName?: string,
  ): Promise<DeviceSession> {
    if (!studentId?.trim() || !deviceId?.trim() || !refreshTokenHash?.trim()) {
      throw new BadRequestException('MISSING_REQUIRED_FIELDS');
    }

    try {
      // 1. Revoke existing session for same device (re-login)
      const { data: existingSessions } = await this.db
        .getClient()
        .from('device_sessions')
        .select('id')
        .eq('student_id', studentId)
        .eq('device_id', deviceId)
        .is('revoked_at', null);

      if (existingSessions && existingSessions.length > 0) {
        await this.db
          .getClient()
          .from('device_sessions')
          .update({ revoked_at: new Date().toISOString() })
          .in(
            'id',
            existingSessions.map((s) => s.id),
          );
      }

      // 2. Check device limit (max 3 active sessions)
      const { count, error: countError } = await this.db
        .getClient()
        .from('device_sessions')
        .select('*', { count: 'exact', head: true })
        .eq('student_id', studentId)
        .is('revoked_at', null);

      if (!countError && count !== null && count >= 3) {
        throw new ForbiddenException('DEVICE_LIMIT_REACHED');
      }

      // 3. Create new device session
      const { data: session, error } = await this.db
        .getClient()
        .from('device_sessions')
        .insert({
          student_id: studentId,
          device_id: deviceId,
          device_name: deviceName?.trim() || null,
          refresh_token_hash: refreshTokenHash,
          last_used_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error || !session) {
        throw new Error('Failed to create device session');
      }

      return session as DeviceSession;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      throw new BadRequestException('DEVICE_SESSION_CREATION_FAILED');
    }
  }

  /**
   * Step 12: Validate refresh token
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
      // Fetch the device session
      const { data: session, error } = await this.db
        .getClient()
        .from('device_sessions')
        .select('*')
        .eq('id', sessionId)
        .eq('student_id', studentId)
        .single();

      if (error || !session) {
        throw new UnauthorizedException('INVALID_SESSION');
      }

      // Check if session is revoked
      if (session.revoked_at !== null) {
        throw new UnauthorizedException('SESSION_REVOKED');
      }

      // Update last_used_at timestamp
      const { error: updateError } = await this.db
        .getClient()
        .from('device_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', sessionId);

      if (updateError) {
        throw new Error('Failed to update session');
      }

      return session as DeviceSession;
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
    const { data: student, error } = await this.db
      .getClient()
      .from('students')
      .select('*')
      .eq('id', studentId)
      .single();

    if (error || !student) {
      throw new BadRequestException('STUDENT_NOT_FOUND');
    }

    return student as Student;
  }

  /**
   * Update student profile details
   */
  async updateStudentProfile(
    studentId: string,
    updates: { firstName?: string; lastName?: string; email?: string },
  ): Promise<Student> {
    const updatePayload: {
      first_name?: string;
      last_name?: string;
      email?: string;
      updated_at: string;
    } = {
      updated_at: new Date().toISOString(),
    };

    if (updates.firstName?.trim()) {
      updatePayload.first_name = updates.firstName.trim();
    }
    if (updates.lastName?.trim()) {
      updatePayload.last_name = updates.lastName.trim();
    }
    if (updates.email?.trim()) {
      updatePayload.email = updates.email.trim().toLowerCase();
    }

    const { data: student, error } = await this.db
      .getClient()
      .from('students')
      .update(updatePayload)
      .eq('id', studentId)
      .select()
      .single();

    if (error || !student) {
      throw new BadRequestException('PROFILE_UPDATE_FAILED');
    }

    return student as Student;
  }

  /**
   * Update a device session refresh token hash
   */
  async updateDeviceSessionRefreshHash(
    sessionId: string,
    refreshTokenHash: string,
  ): Promise<void> {
    const { error } = await this.db
      .getClient()
      .from('device_sessions')
      .update({
        refresh_token_hash: refreshTokenHash,
        last_used_at: new Date().toISOString(),
      })
      .eq('id', sessionId);

    if (error) {
      throw new BadRequestException('SESSION_UPDATE_FAILED');
    }
  }

  /**
   * Revoke a device session
   */
  async revokeDeviceSession(sessionId: string): Promise<void> {
    const { error } = await this.db
      .getClient()
      .from('device_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', sessionId);

    if (error) {
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
    const { data: session, error } = await this.db
      .getClient()
      .from('device_sessions')
      .select('*')
      .eq('student_id', studentId)
      .eq('device_id', deviceId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !session) {
      throw new UnauthorizedException('NO_ACTIVE_SESSION');
    }

    return session as DeviceSession;
  }

  /**
   * Get activation code expiry date for a given code
   */
  async getActivationCodeExpiry(activationCode: string): Promise<string> {
    const { data, error } = await this.db
      .getClient()
      .from('activation_codes')
      .select('expires_at')
      .eq('code', activationCode.trim())
      .single();

    if (error || !data?.expires_at) {
      throw new BadRequestException('INVALID_ACTIVATION_CODE');
    }

    return data.expires_at;
  }

  /**
   * Check if a student's membership has expired.
   * Queries activation_codes by student_id and checks expires_at.
   */
  async checkMembershipExpiry(studentId: string): Promise<void> {
    const { data, error } = await this.db
      .getClient()
      .from('activation_codes')
      .select('expires_at')
      .eq('student_id', studentId)
      .eq('status', 'active')
      .single();

    if (error || !data) {
      throw new UnauthorizedException('INVALID_SESSION');
    }

    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      throw new ForbiddenException('MEMBERSHIP_EXPIRED');
    }
  }
}
