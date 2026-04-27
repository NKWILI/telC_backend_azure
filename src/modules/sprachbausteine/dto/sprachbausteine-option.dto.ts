import { ApiProperty } from '@nestjs/swagger';

export class SprachbausteineOptionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  content!: string;
}
