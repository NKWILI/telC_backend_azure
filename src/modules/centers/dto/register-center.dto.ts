import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MaxUtf8Bytes,
  NormalizeEmail,
  Trim,
} from './center-validation.decorators';

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
  @NormalizeEmail()
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
