import { ApiProperty } from '@nestjs/swagger';
import {
  IsNumber,
  IsString,
  IsArray,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ScoresDto {
  @ApiProperty({ example: 75 })
  @IsNumber()
  @Min(0)
  @Max(100)
  grammar: number;

  @ApiProperty({ example: 72 })
  @IsNumber()
  @Min(0)
  @Max(100)
  vocabulary: number;

  @ApiProperty({ example: 80 })
  @IsNumber()
  @Min(0)
  @Max(100)
  coherence: number;

  @ApiProperty({ example: 76 })
  @IsNumber()
  @Min(0)
  @Max(100)
  overall: number;
}

export class CorrectionDto {
  @ApiProperty({ example: 'Ich gehen oft ins Kino' })
  @IsString()
  original: string;

  @ApiProperty({ example: 'Ich gehe oft ins Kino' })
  @IsString()
  corrected: string;

  @ApiProperty({
    example:
      "Das Verb 'gehen' muss in der ersten Person konjugiert werden: 'ich gehe'.",
  })
  @IsString()
  explanation: string;

  @ApiProperty({ example: 'grammar', enum: ['grammar', 'vocabulary'] })
  @IsString()
  error_type: 'grammar' | 'vocabulary';
}

export class SpeakingEvaluationResponseDto {
  @ApiProperty({
    example:
      'Hallo! Hier sind die Ergebnisse deiner Sprechübung für Teil 1. Insgesamt hast du 76 von 100 Punkten erreicht. Dein Wortschatz ist sehr gut. Achte noch auf die Verbkonjugation — du hast zum Beispiel gesagt: ich gehen — richtig wäre ich gehe. Weiter so, du machst gute Fortschritte!',
  })
  @IsString()
  evaluationText: string;

  @ApiProperty({ type: ScoresDto })
  @ValidateNested()
  @Type(() => ScoresDto)
  scores: ScoresDto;

  @ApiProperty({ type: [CorrectionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CorrectionDto)
  corrections: CorrectionDto[];

  @ApiProperty({
    example:
      'Der Schüler spricht klar und verwendet abwechslungsreiche Ausdrücke.',
  })
  @IsString()
  strengths: string;

  @ApiProperty({
    example: 'Die Verbkonjugation sollte noch verbessert werden.',
  })
  @IsString()
  areas_for_improvement: string;
}
