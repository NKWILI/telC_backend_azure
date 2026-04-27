import { ApiProperty } from '@nestjs/swagger';

export class SprachbausteineTeil2GapDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  correctWordId!: string;
}
