import { ApiProperty } from '@nestjs/swagger';
import { TopicDto } from './topic.dto';

export class CreateRoomResponseDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' })
  roomId: string;

  @ApiProperty({
    description: 'Private token. Only share roomId, never hostToken.',
  })
  hostToken: string;

  @ApiProperty({ example: '2026-06-14T14:00:00.000Z' })
  expiresAt: string;

  @ApiProperty({ type: TopicDto })
  topic: TopicDto;
}
