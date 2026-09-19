import { Transform, type TransformFnParams } from 'class-transformer';
import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

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
