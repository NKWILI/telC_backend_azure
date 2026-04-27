import { ApiProperty } from '@nestjs/swagger';

export class LesenTeil1TitleDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  content!: string;
}
