import { ApiProperty } from '@nestjs/swagger';
import { LesenTeil3SituationDto } from './lesen-teil3-situation.dto';
import { LesenTeil3AnnouncementDto } from './lesen-teil3-announcement.dto';

export class LesenTeil3Dto {
  @ApiProperty()
  label!: string;

  @ApiProperty()
  instruction!: string;

  @ApiProperty({ type: () => LesenTeil3SituationDto, isArray: true })
  situations!: LesenTeil3SituationDto[];

  @ApiProperty({ type: () => LesenTeil3AnnouncementDto, isArray: true })
  announcements!: LesenTeil3AnnouncementDto[];

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  correctMatches!: Record<string, string>;
}
