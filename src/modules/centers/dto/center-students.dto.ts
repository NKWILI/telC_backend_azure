import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { NormalizeEmail, Trim } from './center-validation.decorators';

/**
 * Everything a center may supply when creating a student.
 *
 * The allowlist is the security boundary. With the global pipe's
 * `forbidNonWhitelisted`, anything absent here — `password`, `centerId`,
 * `activationKey`, `activatedAt` — is a 400 before a handler runs. A center
 * must never be able to set a student's password or move them to another
 * center, and the absence of those fields is what enforces it.
 */
export class ProvisionStudentDto {
  @ApiProperty({ example: 'Awa', maxLength: 100 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'Mbarga', maxLength: 100 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;

  @ApiProperty({ format: 'email', maxLength: 254 })
  @NormalizeEmail()
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    example: '+237690000000',
    description:
      'WhatsApp number. Optional, but the channel that reaches people.',
    maxLength: 30,
  })
  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Matches(/^\+?[0-9 ()-]{5,30}$/, { message: 'Phone number is invalid' })
  phone?: string;
}

/** Name and phone only. Email is identity and is not editable here. */
export class UpdateStudentDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({ maxLength: 30 })
  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  @Matches(/^\+?[0-9 ()-]{5,30}$/, { message: 'Phone number is invalid' })
  phone?: string;
}

export class ListStudentsQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page = 1;

  // Capped so one request cannot pull an entire roster, and so a large center
  // cannot turn a dashboard refresh into an unbounded query.
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export class CenterStudentDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiPropertyOptional({ nullable: true }) firstName: string | null;
  @ApiPropertyOptional({ nullable: true }) lastName: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'email' }) email:
    | string
    | null;
  @ApiPropertyOptional({ nullable: true }) phone: string | null;

  @ApiProperty({
    description: 'Whether the student redeemed their key and set a password.',
  })
  activated: boolean;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  activatedAt: Date | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  activationKeyExpiresAt: Date | null;

  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) lastSeenAt: Date;
}

export class CenterStudentListDto {
  @ApiProperty({ type: [CenterStudentDto] }) students: CenterStudentDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
}

export class ActivationKeyDto {
  @ApiProperty({
    description:
      'Shown once. Only its hash is stored, so it cannot be recovered — mint a new one instead.',
  })
  activationKey: string;

  @ApiProperty({ type: String, format: 'date-time' })
  activationKeyExpiresAt: Date;
}

/**
 * The provisioning response: the student, plus the key.
 *
 * `activationKeyExpiresAt` is inherited rather than redeclared — the base
 * already carries it, and narrowing it here only duplicates the field.
 */
export class ProvisionedStudentDto extends CenterStudentDto {
  @ApiProperty({ description: 'Shown once, at creation. Never recoverable.' })
  activationKey: string;
}
