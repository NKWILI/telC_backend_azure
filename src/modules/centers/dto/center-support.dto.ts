import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { NormalizeEmail, Trim } from './center-validation.decorators';

export class SupportContactDto {
  @ApiProperty({
    maxLength: 200,
    description: 'Prefilled with the manager name; stored as sent.',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiProperty({
    format: 'email',
    description:
      'Where the team replies. Prefilled with the manager email; the acknowledgement always goes to the account email.',
  })
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ minLength: 10, maxLength: 5000 })
  @Trim()
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  message: string;
}

export class SupportRequestCreatedDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
}
