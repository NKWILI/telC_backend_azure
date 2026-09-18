import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  MaxUtf8Bytes,
  NormalizeEmail,
  StrongPassword,
  Trim,
} from './center-validation.decorators';

/**
 * Everything registration collects. Five fields, deliberately.
 *
 * Country, city, the manager's phone and the logo were all required here and
 * have moved to onboarding, where they are collected at the point a center
 * goes to pay. The reasoning: none of them is needed to run a trial, and all
 * of them are needed to take money, so asking at registration is paperwork
 * before the product has proved anything.
 *
 * The global pipe runs with `forbidNonWhitelisted`, so a client still sending
 * one of the four is refused rather than silently ignored. A client that
 * believes it set a country should not be left believing it.
 */
export class RegisterCenterDto {
  @ApiProperty({ example: 'Goethe Language Center', maxLength: 150 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  centerName: string;

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
  @NormalizeEmail()
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 8, maxLength: 72, format: 'password' })
  @IsString()
  @MinLength(8)
  @MaxUtf8Bytes(72)
  // One rule for every place a password is set — register, reset, and change
  // from inside the dashboard. Three forms with three rules is how a password
  // accepted by one is refused by the next.
  @StrongPassword()
  password: string;
}
