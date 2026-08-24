import { ApiProperty } from '@nestjs/swagger';
import {
  IsUUID,
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
} from 'class-validator';

export class JoinRoomDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' })
  @IsUUID()
  roomId: string;

  @ApiProperty({ example: 'Anna', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  displayName: string;

  @ApiProperty({
    required: false,
    description: 'Provided by the host only; omit for guests',
  })
  @IsString()
  @IsOptional()
  hostToken?: string;
}
