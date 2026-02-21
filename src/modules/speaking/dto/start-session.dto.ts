import { IsNumber, IsBoolean, Min, Max } from 'class-validator';

export class StartSessionDto {
  @IsNumber()
  @Min(1)
  @Max(3)
  teilNumber: number;

  @IsBoolean()
  useTimer: boolean;
}
