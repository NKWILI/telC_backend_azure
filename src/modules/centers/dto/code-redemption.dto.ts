import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RedeemCodeDto {
  @ApiProperty({
    example: 'LQ-7K2P-94QX',
    description:
      'As the school gave it. Lower case, spaces and missing dashes are accepted.',
  })
  @IsString()
  @IsNotEmpty()
  // Generous for spaces and dashes a person may add; still bounded so the
  // route cannot be handed a megabyte to normalise.
  @MaxLength(40)
  code: string;
}

export class RedemptionResultDto {
  @ApiProperty({ enum: ['start', 'pro', 'premium'], example: 'start' })
  planId: 'start' | 'pro' | 'premium';

  @ApiProperty({ example: 'Institut Goethe Douala' })
  centerName: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    format: 'date-time',
    description:
      'When this seat stops working. A trial code ends with the trial; null means it follows the school subscription.',
  })
  expiresAt: Date | null;
}
