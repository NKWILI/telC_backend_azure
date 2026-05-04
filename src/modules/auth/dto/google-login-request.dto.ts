import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class GoogleLoginRequestDto {
  @IsNotEmpty()
  @IsString()
  idToken: string;

  @IsNotEmpty()
  @IsString()
  deviceId: string;

  @IsOptional()
  @IsString()
  deviceName?: string;
}
