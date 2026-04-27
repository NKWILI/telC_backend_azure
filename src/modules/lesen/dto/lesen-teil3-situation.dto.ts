import { ApiProperty } from '@nestjs/swagger';

export class LesenTeil3SituationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  content!: string;
}
