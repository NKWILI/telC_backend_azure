import { IsEnum, IsOptional } from 'class-validator';

export class EndSessionDto {
  @IsOptional()
  @IsEnum(['completed', 'cancelled'])
  reason?: 'completed' | 'cancelled';
}
