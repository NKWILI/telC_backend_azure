import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
// `import type`: the decorated `level?` signature emits metadata, and with
// isolatedModules a value import of a type-only symbol is a compile error.
import type { SpeakingLevel } from '../speaking-topics.data';

const SPEAKING_LEVELS: SpeakingLevel[] = ['B1'];

export class FindPartnerDto {
  /**
   * Shown to a stranger, so it is constrained to something that reads as a
   * first name. Digits are rejected because an unconstrained name field in
   * front of strangers is a contact-sharing channel — the obvious use being to
   * broadcast a phone number or WhatsApp handle into the lobby.
   */
  @ApiProperty({ example: 'Anna', maxLength: 30 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  @Matches(/^[^\d]+$/, {
    message: 'displayName must not contain digits',
  })
  displayName: string;

  @ApiPropertyOptional({
    enum: SPEAKING_LEVELS,
    default: 'B1',
    description:
      'Only B1 exists today, and every topic is B1. The field is here so ' +
      'adding levels later is a data change rather than a protocol change.',
  })
  @IsOptional()
  @IsIn(SPEAKING_LEVELS)
  level?: SpeakingLevel;
}
