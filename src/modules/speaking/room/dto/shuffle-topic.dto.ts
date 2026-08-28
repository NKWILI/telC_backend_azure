import { IsUUID } from 'class-validator';

export class ShuffleTopicDto {
  @IsUUID()
  roomId: string;
}
