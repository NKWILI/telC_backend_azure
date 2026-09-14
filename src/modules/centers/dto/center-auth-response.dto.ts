import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CenterUserRole } from '@prisma/client';

export class CenterAuthUserDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: CenterUserRole })
  role: CenterUserRole;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastName: string;

  @ApiProperty({ format: 'email' })
  email: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Null until the manager completes onboarding. Registration no longer collects it.',
  })
  phone: string | null;

  @ApiProperty()
  emailVerified: boolean;
}

export class CenterAuthCenterDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  // Both null until onboarding is complete. A client should read the
  // `onboarding` block rather than inferring completeness from these.
  @ApiPropertyOptional({ nullable: true, example: 'CM' })
  country: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Douala' })
  city: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'uri' })
  logoUrl: string | null;
}

export class CenterTokenPairDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  refreshToken: string;
}

export class CenterMessageResponseDto {
  @ApiProperty({ example: 'If that account exists, a reset code was sent.' })
  message: string;
}

export class CenterLogoutResponseDto {
  @ApiProperty({ example: true })
  success: true;
}

export class CenterAuthResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  refreshToken: string;

  @ApiProperty({ type: CenterAuthUserDto })
  centerUser: CenterAuthUserDto;

  @ApiProperty({ type: CenterAuthCenterDto })
  center: CenterAuthCenterDto;
}
