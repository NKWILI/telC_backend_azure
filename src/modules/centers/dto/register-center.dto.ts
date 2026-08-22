import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

function Trim() {
  return Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  );
}

function MaxUtf8Bytes(maximum: number, options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'maxUtf8Bytes',
      target: object.constructor,
      propertyName,
      constraints: [maximum],
      options,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          return (
            typeof value === 'string' &&
            Buffer.byteLength(value, 'utf8') <= Number(args.constraints[0])
          );
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must not exceed ${args.constraints[0]} UTF-8 bytes`;
        },
      },
    });
  };
}

export class RegisterCenterDto {
  @ApiProperty({ example: 'Goethe Language Center', maxLength: 150 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  centerName: string;

  @ApiProperty({ example: 'Cameroon', maxLength: 100 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  country: string;

  @ApiProperty({ example: 'Douala', maxLength: 100 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/centers/logo.webp',
    maxLength: 2048,
  })
  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @Matches(/^https:\/\//i, { message: 'Logo URL must use HTTPS' })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  logoUrl?: string;

  @ApiProperty({ example: 'Alain', maxLength: 100 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  managerFirstName: string;

  @ApiProperty({ example: 'Ngeukeu', maxLength: 100 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  managerLastName: string;

  @ApiProperty({ example: 'manager@example.com', maxLength: 254 })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  @IsEmail()
  email: string;

  @ApiProperty({ example: '+237690000000', maxLength: 30 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  @Matches(/^\+?[0-9 ()-]{5,30}$/, { message: 'Phone number is invalid' })
  phone: string;

  @ApiProperty({ minLength: 8, maxLength: 72, format: 'password' })
  @IsString()
  @MinLength(8)
  @MaxUtf8Bytes(72)
  password: string;
}
