import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min, Max, MinLength } from 'class-validator';

export class EvaluateSpeakingDto {
  @ApiProperty({ example: 1, enum: [1, 2, 3] })
  @IsInt()
  @Min(1)
  @Max(3)
  teilNumber: number;

  @ApiProperty({
    example: 'Ich heiße Alain. Ich komme aus Kamerun und lerne seit zwei Jahren Deutsch.',
    minLength: 10,
  })
  @IsString()
  @MinLength(10)
  transcript: string;
}
