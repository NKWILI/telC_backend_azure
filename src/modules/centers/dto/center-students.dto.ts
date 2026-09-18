import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Tier } from '@prisma/client';
import { Trim } from './center-validation.decorators';

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

  @ApiPropertyOptional({
    enum: Tier,
    example: Tier.PRO,
    description:
      'Move this student into another tier. Allowed only when the center holds a free seat there — a full tier answers SEAT_LIMIT_REACHED and a tier the center has never bought answers TIER_NOT_HELD, both naming the tier. No pro-rating: access changes immediately and the price difference settles at the next renewal.',
  })
  @IsOptional()
  @IsEnum(Tier)
  tier?: Tier;
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
