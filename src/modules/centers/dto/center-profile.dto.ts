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

/**
 * Where a center stands in onboarding, worked out on every read.
 *
 * Read `complete` to decide what to show. Do not infer it by checking whether
 * country and city are present — that would be a second definition of the
 * rule, living in the client, free to drift from this one.
 */
export class CenterOnboardingStateDto {
  @ApiProperty({
    example: false,
    description:
      'True once every required field is supplied. The only thing a client should branch on.',
  })
  complete: boolean;

  @ApiProperty({
    type: [String],
    example: ['country', 'city', 'phone'],
    description:
      'Exactly the fields still needed, in a stable order so a checklist does not reshuffle between requests. Render the checklist from this rather than hard-coding the list.',
  })
  missing: string[];
}

export class CenterProfileResponseDto {
  @ApiProperty({ type: CenterAuthUserDto })
  centerUser: CenterAuthUserDto;

  @ApiProperty({ type: CenterAuthCenterDto })
  center: CenterAuthCenterDto;

  @ApiProperty({ type: CenterOnboardingStateDto })
  onboarding: CenterOnboardingStateDto;
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
