import { BadRequestException } from '@nestjs/common';
import { createGlobalValidationPipe } from '../src/shared/pipes/global-validation.pipe';
import { RegisterRequestDto } from '../src/modules/auth/dto/register-request.dto';
import { ResetPasswordRequestDto } from '../src/modules/auth/dto/reset-password-request.dto';

/**
 * T2: students get the same password rule as centers wherever a password is
 * set — at least 8 characters, an uppercase letter, a digit, a special
 * character, at most 72 bytes. Never checked at login, so older passwords
 * keep working.
 */
describe('the student password rule (T2)', () => {
  const pipe = createGlobalValidationPipe();

  const refusal = async (metatype: unknown, body: Record<string, unknown>) => {
    const error = (await pipe
      .transform(body, { type: 'body', metatype: metatype as never })
      .catch((e: unknown) => e)) as BadRequestException | undefined;
    return error instanceof BadRequestException
      ? (error.getResponse() as { message: string[] }).message
      : null;
  };

  const register = (password: string) =>
    refusal(RegisterRequestDto, {
      firstName: 'Awa',
      lastName: 'Mbarga',
      email: 'awa@example.com',
      password,
    });

  const reset = (newPassword: string) =>
    refusal(ResetPasswordRequestDto, {
      token: 'token',
      newPassword,
      deviceId: 'device-1',
    });

  it.each([
    ['too short', 'Ab1!', 'PASSWORD_TOO_SHORT'],
    ['without an uppercase letter', 'abcdefg1!', 'PASSWORD_NEEDS_UPPERCASE'],
    ['without a digit', 'Abcdefgh!', 'PASSWORD_NEEDS_DIGIT'],
    ['without a special character', 'Abcdefgh1', 'PASSWORD_NEEDS_SPECIAL'],
  ])('refuses a password %s, at sign-up and at reset', async (_c, pw, code) => {
    expect(await register(pw)).toContain(code);
    expect(await reset(pw)).toContain(code);
  });

  it('accepts a password that meets the rule', async () => {
    expect(await register('Abcdefg1!')).toBeNull();
    expect(await reset('Abcdefg1!')).toBeNull();
  });
});
