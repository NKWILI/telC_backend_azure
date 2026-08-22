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

  @ApiProperty()
  phone: string;

  @ApiProperty()
  emailVerified: boolean;
}

export class CenterAuthCenterDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  country: string;

  @ApiProperty()
  city: string;

  @ApiPropertyOptional({ nullable: true, format: 'uri' })
  logoUrl: string | null;
}

export class CenterTokenPairDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  refreshToken: string;
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
