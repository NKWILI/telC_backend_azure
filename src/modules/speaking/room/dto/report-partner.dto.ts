import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReportPartnerDto {
  /**
   * Free text, and the only field. The room is derived server-side from the
   * socket, exactly as leave-room does — a client that could name the room it
   * is reporting could end someone else's call.
   */
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
