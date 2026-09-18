import { Transform, type TransformFnParams } from 'class-transformer';
import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { checkPassword } from '../../../shared/password-policy';

export function Trim() {
  return Transform((params: TransformFnParams) => {
    const value = params.value as unknown;
    return typeof value === 'string' ? value.trim() : value;
  });
}

export function NormalizeEmail() {
  return Transform((params: TransformFnParams) => {
    const value = params.value as unknown;
    return typeof value === 'string' ? value.trim().toLowerCase() : value;
  });
}

export function MaxUtf8Bytes(maximum: number, options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'maxUtf8Bytes',
      target: object.constructor,
      propertyName,
      constraints: [maximum],
      options,
      validator: {
        validate(value: unknown): boolean {
          return (
            typeof value === 'string' &&
            Buffer.byteLength(value, 'utf8') <= maximum
          );
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must not exceed ${maximum} UTF-8 bytes`;
        },
      },
    });
  };
}

/**
 * The shared password rule, applied wherever a password is set.
 *
 * The rule itself lives in `shared/password-policy`, so the API, and later the
 * student side, cannot drift into three different answers to "is this password
 * acceptable". Here it only becomes a field error, which is what a form needs.
 */
export function StrongPassword(options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'strongPassword',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && checkPassword(value) === null;
        },
        defaultMessage(args: ValidationArguments): string {
          const refusal =
            typeof args.value === 'string'
              ? checkPassword(args.value)
              : 'PASSWORD_TOO_SHORT';

          // The specific reason, not a paragraph listing every rule: a person
          // fixing a password needs the one thing that is wrong with theirs.
          return refusal ?? 'PASSWORD_INVALID';
        },
      },
    });
  };
}
