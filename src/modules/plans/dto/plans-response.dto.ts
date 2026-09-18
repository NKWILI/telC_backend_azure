import { ApiProperty } from '@nestjs/swagger';
import type { PlanId } from '../plans.catalog';

export class AiSpeakingAllowanceDto {
  @ApiProperty({
    example: 2,
    description: 'Successful AI speaking evaluations allowed in the window.',
  })
  limit: number;

  @ApiProperty({
    example: 'per_24h',
    description:
      'A rolling 24-hour window, not a calendar day: there is no timezone in it and nothing resets at midnight.',
  })
  window: string;
}

export class PlanDto {
  @ApiProperty({ example: 'start', enum: ['start', 'pro', 'premium'] })
  id: PlanId;

  @ApiProperty({
    example: 4500,
    description:
      'Whole XAF, per seat per month, from the same constant a quote is priced with. A center already holding this tier keeps the price stamped on its seat row, which can be lower.',
  })
  monthlyPricePerSeatXaf: number;

  @ApiProperty({ type: AiSpeakingAllowanceDto })
  aiSpeaking: AiSpeakingAllowanceDto;

  @ApiProperty({
    example: false,
    description:
      'Whether this plan reaches the exam module, derived from the tier that guards `/api/modelltests`.',
  })
  examModule: boolean;
}

export class PlansResponseDto {
  @ApiProperty({
    example: 10,
    description: 'Fewest seats a first paid purchase may total, across tiers.',
  })
  minSeats: number;

  @ApiProperty({
    type: [PlanDto],
    description:
      'Cheapest first. Names and descriptions are not here: they are translations and belong to the client.',
  })
  plans: PlanDto[];
}
