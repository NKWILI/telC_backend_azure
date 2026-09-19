import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { checkPassword } from './password-policy';

/**
 * The shared password rule, applied wherever a password is set.
 *
 * The rule itself lives in `shared/password-policy`, so centers and students
 * cannot drift into different answers to "is this password acceptable" (T2).
 * Here it only becomes a field error, which is what a form needs.
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
