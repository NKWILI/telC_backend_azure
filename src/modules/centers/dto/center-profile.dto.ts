import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsNotEmpty,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';
import { Trim } from './center-validation.decorators';
import {
  CenterAuthCenterDto,
  CenterAuthUserDto,
} from './center-auth-response.dto';

export class CenterProfileResponseDto {
  @ApiProperty({ type: CenterAuthUserDto })
  centerUser: CenterAuthUserDto;

  @ApiProperty({ type: CenterAuthCenterDto })
  center: CenterAuthCenterDto;
}

/**
 * The allowlist *is* the security boundary. Every field a center may change
 * about itself is declared here, and the global pipe's `forbidNonWhitelisted`
 * turns anything else — `role`, `email`, `emailVerified`, `centerId`,
 * `password` — into a 400 before a handler ever runs. Adding a property here
 * grants write access, so add deliberately.
 */
export class UpdateCenterProfileDto {
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

  @ApiPropertyOptional({ maxLength: 150 })
  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  centerName?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  country?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ maxLength: 2048 })
  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @Matches(/^https:\/\//i, { message: 'Logo URL must use HTTPS' })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  logoUrl?: string;
}
