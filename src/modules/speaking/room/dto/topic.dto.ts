import { ApiProperty } from '@nestjs/swagger';
import type { SpeakingLevel } from '../speaking-topics.data';

export class TopicDto {
  @ApiProperty({ example: 'b1-t2-001' })
  id: string;

  @ApiProperty({ enum: ['B1'], example: 'B1' })
  level: SpeakingLevel;

  @ApiProperty({ enum: [2], example: 2 })
  teil: 2;

  @ApiProperty({ example: 'Reisen mit einer Gruppe' })
  title: string;

  @ApiProperty({
    example: 'Gruppenreisen sind praktisch, weil alles organisiert ist.',
  })
  positionA: string;

  @ApiProperty({ example: 'Allein zu reisen gibt mehr Freiheit und Ruhe.' })
  positionB: string;

  @ApiProperty({ type: [String], minItems: 2, maxItems: 4 })
  followUpQuestions: string[];
}
