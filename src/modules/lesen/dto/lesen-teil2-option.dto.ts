import { ApiProperty } from '@nestjs/swagger';

export class LesenTeil2OptionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  content!: string;
}
