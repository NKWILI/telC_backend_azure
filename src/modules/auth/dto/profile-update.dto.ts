import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CefrLevel } from '@prisma/client';

export class ProfileUpdateDto {
  @ApiPropertyOptional({ minLength: 2, example: 'Ada' })
  @IsOptional()
  @IsString({ message: 'First name must be a string' })
  @MinLength(2, { message: 'First name must be at least 2 characters' })
  firstName?: string;

  @ApiPropertyOptional({ minLength: 2, example: 'Lovelace' })
  @IsOptional()
  @IsString({ message: 'Last name must be a string' })
  @MinLength(2, { message: 'Last name must be at least 2 characters' })
  lastName?: string;

  @ApiPropertyOptional({ format: 'email', example: 'ada@example.com' })
  @IsOptional()
  @IsEmail({}, { message: 'Email must be a valid email address' })
  email?: string;

  @ApiPropertyOptional({
    enum: CefrLevel,
    description: 'The student current German level (D38).',
  })
  @IsOptional()
  @IsEnum(CefrLevel)
  level?: CefrLevel;
}
