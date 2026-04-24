import type { LesenTeil3SituationDto } from './lesen-teil3-situation.dto';
import type { LesenTeil3AnnouncementDto } from './lesen-teil3-announcement.dto';

export interface LesenTeil3Dto {
  label: string;
  instruction: string;
  situations: LesenTeil3SituationDto[];
  announcements: LesenTeil3AnnouncementDto[];
  correctMatches: Record<string, string>;
}
