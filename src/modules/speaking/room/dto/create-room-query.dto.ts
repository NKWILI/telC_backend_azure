import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import type { SpeakingLevel } from '../speaking-topics.data';

export class CreateRoomQueryDto {
  @ApiProperty({ enum: ['B1'], example: 'B1' })
  @IsIn(['B1'])
  level: SpeakingLevel;
}
