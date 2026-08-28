import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class EndLiveSessionDto {
  @ApiProperty({
    example: 'f2c1a0e4-9b3d-4c7a-8e1f-0a2b3c4d5e6f',
    description: 'The sessionId returned by POST /api/speaking/live-token.',
  })
  @IsUUID()
  sessionId: string;
}
