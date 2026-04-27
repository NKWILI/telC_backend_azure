import { ApiProperty } from '@nestjs/swagger';

export class SprachbausteineWordBankItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  letter!: string;

  @ApiProperty()
  content!: string;
}
