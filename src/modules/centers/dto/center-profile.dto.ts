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
import type { Tier } from '@prisma/client';
import {
  CenterAuthCenterDto,
  CenterAuthUserDto,
} from './center-auth-response.dto';
import { CENTER_SUBSCRIPTION_STATUSES } from './center-subscription-response.dto';
import type {
  CenterPaymentStatus,
  OnboardingStep,
} from '../center-account-state';

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

/**
 * Where the center stands, worked out on every read.
 *
 * No column backs any of this. A stored `paymentStatus` needs a job to flip it
 * when a trial ends, and a job that runs late leaves the badge saying "trial"
 * while the students are already blocked.
 */
export class CenterAccountStateDto {
  @ApiProperty({
    enum: ['unpaid', 'trial', 'paid'],
    example: 'trial',
    description:
      'What a manager is shown. Coarse on purpose: a grace period still reads as paid, because access continues and the bill is late rather than unpaid.',
  })
  paymentStatus: CenterPaymentStatus;

  @ApiProperty({
    enum: CENTER_SUBSCRIPTION_STATUSES,
    example: 'TRIAL',
    description:
      'The precise state behind `paymentStatus`, for the cases where the difference is a different sentence: GRACE_PERIOD means "payment late", BLOCKED means "access stopped".',
  })
  subscriptionStatus: (typeof CENTER_SUBSCRIPTION_STATUSES)[number];

  @ApiProperty({
    example: false,
    description:
      'True once a trial has started or a payment has ever succeeded. It never goes back to false: a lapsed center owes money, it does not owe its details again.',
  })
  onboardingCompleted: boolean;

  @ApiProperty({
    example: 3,
    enum: [1, 2, 3, 4],
    description:
      'Where the wizard resumes: 1 manager details, 2 school details, 3 plan, 4 finished.',
  })
  onboardingStep: OnboardingStep;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  trialEndsAt: Date | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  paidUntil: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    format: 'date-time',
    description: 'When a lapsed paid period stops being tolerated.',
  })
  graceEndsAt: Date | null;

  @ApiProperty({
    description:
      'Whether this center students may currently learn. Read this rather than re-deriving access from the dates.',
  })
  studentsMayLearn: boolean;

  @ApiProperty({
    example: { START: 7, PRO: 3, PREMIUM: 0 },
    description:
      'Seats held per tier, zeros included, from the seat rows. Absent and zero mean the same thing to a dashboard.',
  })
  seats: Record<Tier, number>;
}

export class CenterProfileResponseDto {
  @ApiProperty({ type: CenterAuthUserDto })
  centerUser: CenterAuthUserDto;

  @ApiProperty({ type: CenterAuthCenterDto })
  center: CenterAuthCenterDto;

  @ApiProperty({ type: CenterOnboardingStateDto })
  onboarding: CenterOnboardingStateDto;

  @ApiProperty({ type: CenterAccountStateDto })
  account: CenterAccountStateDto;
}

/**
 * What a center may change about the school itself.
 *
 * The allowlist *is* the boundary: the global pipe runs with
 * `forbidNonWhitelisted`, so anything not declared here — `centerId`,
 * `onboardingCompleted`, a price — is a 400 before a handler runs. Adding a
 * property grants write access, so add deliberately.
 *
 * `regionId` is absent on purpose. It is looked up from the city, so a client
 * cannot file a city under a region it does not belong to.
 */
export class UpdateCenterDto {
  @ApiPropertyOptional({ maxLength: 150, description: 'The school name.' })
  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({
    example: 'CM',
    description:
      'From `GET /api/locations`. Decides which address fields are required.',
  })
  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2)
  countryCode?: string;

  @ApiPropertyOptional({
    example: 'douala',
    description:
      'A city id from `GET /api/locations`. Use this or `cityOther`.',
  })
  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  cityId?: string;

  @ApiPropertyOptional({
    example: 'Kribi',
    description:
      'A town we do not list yet. Sent instead of `cityId`, never with it, so a school is never blocked by a missing city.',
  })
  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  cityOther?: string;

  @ApiPropertyOptional({
    example: 'Akwa',
    description: 'Quarter. Required in Cameroon, optional in Germany.',
  })
  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  district?: string;

  @ApiPropertyOptional({
    example: '45127',
    description: 'Required in Germany, not collected in Cameroon.',
  })
  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  postalCode?: string;

  @ApiPropertyOptional({ example: 'Hauptstraße', maxLength: 150 })
  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  street?: string;

  @ApiPropertyOptional({ example: '12', maxLength: 20 })
  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  houseNumber?: string;

  @ApiPropertyOptional({
    maxLength: 2048,
    description:
      'An https URL to the school logo. Kept here until the upload route exists, so a center that already hosts its logo somewhere does not lose the ability to point at it.',
  })
  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @Matches(/^https:\/\//i, { message: 'Logo URL must use HTTPS' })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  logoUrl?: string;
}

/**
 * What a manager may change about themselves.
 *
 * No address fields: nothing is ever posted to a manager, so asking for a
 * street would be collecting personal data with no purpose. `email` is absent
 * because changing it is a verification flow, not a profile edit.
 */
export class UpdateCenterManagerDto {
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

  @ApiPropertyOptional({
    maxLength: 30,
    description:
      'The manager own number. This is who gets contacted about a late payment.',
  })
  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  @Matches(/^\+?[0-9 ()-]{5,30}$/, { message: 'Phone number is invalid' })
  phone?: string;

  @ApiPropertyOptional({ example: 'CM' })
  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2)
  countryCode?: string;

  @ApiPropertyOptional({ example: 'yaounde' })
  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  cityId?: string;

  @ApiPropertyOptional({ example: 'Kribi' })
  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  cityOther?: string;
}
