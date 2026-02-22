import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class LoginWithCodeRequestDto {
  @IsNotEmpty({ message: 'Activation code is required' })
  @IsString()
  @MinLength(1)
  activationCode: string;

  @IsNotEmpty({ message: 'Device ID is required' })
  @IsString()
  @MinLength(1)
  deviceId: string;
}
