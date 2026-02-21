import { IsString, IsEmail, MinLength, IsNotEmpty } from 'class-validator';

export class ActivateRequestDto {
  @IsNotEmpty({ message: 'Activation code is required' })
  @IsString({ message: 'Activation code must be a string' })
  @MinLength(1, { message: 'Activation code cannot be empty' })
  activationCode: string;

  @IsNotEmpty({ message: 'Device ID is required' })
  @IsString({ message: 'Device ID must be a string' })
  deviceId: string;

  @IsNotEmpty({ message: 'First name is required' })
  @IsString({ message: 'First name must be a string' })
  @MinLength(2, { message: 'First name must be at least 2 characters' })
  firstName: string;

  @IsNotEmpty({ message: 'Last name is required' })
  @IsString({ message: 'Last name must be a string' })
  @MinLength(2, { message: 'Last name must be at least 2 characters' })
  lastName: string;

  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Email must be a valid email address' })
  email: string;
}
