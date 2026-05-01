import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class GoogleLinkRequestDto {
  @IsNotEmpty()
  @IsString()
  linkingToken: string;

  @IsNotEmpty()
  @IsString()
  deviceId: string;

  @IsOptional()
  @IsString()
  deviceName?: string;
}
