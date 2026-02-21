import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'isBase64', async: false })
export class IsBase64Constraint implements ValidatorConstraintInterface {
  validate(value: any): boolean {
    if (typeof value !== 'string') {
      return false;
    }
    // Validate Base64 format: alphanumeric + / and + with optional = padding
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    if (!base64Regex.test(value)) {
      return false;
    }
    // Verify it can be decoded and re-encoded correctly
    try {
      return Buffer.from(value, 'base64').toString('base64') === value;
    } catch {
      return false;
    }
  }

  defaultMessage(): string {
    return 'Audio data must be valid Base64 encoded string';
  }
}

export function IsBase64(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsBase64Constraint,
    });
  };
}
