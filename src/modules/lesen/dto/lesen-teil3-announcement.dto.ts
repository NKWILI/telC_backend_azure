import { ApiProperty } from '@nestjs/swagger';

export class LesenTeil3AnnouncementDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  content!: string;
}
