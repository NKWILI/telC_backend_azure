import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StrongPassword } from '../../../shared/strong-password.decorator';
import { CefrLevel } from '@prisma/client';

export class RegisterRequestDto {
  @ApiProperty({ example: 'Ada' })
  @IsNotEmpty({ message: 'First name is required' })
  @IsString({ message: 'First name must be a string' })
  firstName: string;

  @ApiProperty({ example: 'Lovelace' })
  @IsNotEmpty({ message: 'Last name is required' })
  @IsString({ message: 'Last name must be a string' })
  lastName: string;

  @ApiProperty({ format: 'email', example: 'ada@example.com' })
  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Email must be valid' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  email: string;

  @ApiProperty({
    minLength: 8,
    format: 'password',
    description:
      'At least 8 characters with an uppercase letter, a digit and a special character; at most 72 bytes (T2).',
  })
  @IsNotEmpty({ message: 'Password is required' })
  @IsString({ message: 'Password must be a string' })
  @StrongPassword()
  password: string;

  @ApiPropertyOptional({
    enum: CefrLevel,
    example: CefrLevel.A2,
    description: 'The student current German level, as they judge it (D38).',
  })
  @IsOptional()
  @IsEnum(CefrLevel)
  level?: CefrLevel;
}
