import { IsString, IsNotEmpty } from 'class-validator';

export class RefreshRequestDto {
  @IsNotEmpty({ message: 'Refresh token is required' })
  @IsString({ message: 'Refresh token must be a string' })
  refreshToken: string;
}
