import { ApiProperty } from '@nestjs/swagger';

export class LesenTeil1TextDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true })
  von!: string | null;

  @ApiProperty({ nullable: true })
  an!: string | null;

  @ApiProperty()
  body!: string;
}
