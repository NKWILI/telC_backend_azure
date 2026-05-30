import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WritingExerciseContact {
  @ApiProperty({ example: 'CenterBüros GmbH' })
  name: string;

  @ApiProperty({ type: [String], example: ['Neuer Wall 120', '50160 Köln'] })
  lines: string[];
}

export class WritingExerciseStimulus {
  @ApiProperty({ example: 'Büroräume in Neubaukomplex zu vermieten!' })
  heading: string;

  @ApiPropertyOptional({ example: 'In unserem neu gebauten Bürogebäude sind noch Räume frei' })
  body?: string;

  @ApiPropertyOptional({ type: [String], example: ['zentrale Lage', 'Kaffeeküche'] })
  features?: string[];

  @ApiPropertyOptional({ example: 'Vereinbaren Sie einen Besichtigungstermin...' })
  callToAction?: string;

  @ApiPropertyOptional({ type: WritingExerciseContact })
  contact?: WritingExerciseContact;
}

export class WritingExerciseDto {
  @ApiProperty({ description: 'Exercise UUID', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id: string;

  @ApiProperty({ description: 'Always 1 for TELC B1+ Beruf (one writing task)', example: 1 })
  part: number;

  @ApiProperty({ example: 'E-Mail / Brief' })
  title: string;

  @ApiPropertyOptional({ example: 'Formeller Brief' })
  subtitle?: string;

  @ApiProperty({ enum: ['brief', 'forumsbeitrag'], example: 'brief' })
  taskType: 'brief' | 'forumsbeitrag';

  @ApiPropertyOptional({ example: 'Sie sehen folgende Anzeige:' })
  intro?: string;

  @ApiPropertyOptional({ type: WritingExerciseStimulus })
  stimulus?: WritingExerciseStimulus;

  @ApiProperty({
    description: 'Main task instructions shown to the student',
    example: 'Sie arbeiten in einem Übersetzerbüro. Schreiben Sie einen Brief...',
  })
  taskInstructions: string;

  @ApiProperty({
    description: 'Required content points the student must address',
    type: [String],
    example: ['Beschreiben Sie Ihr Unternehmen.', 'Was für Räume brauchen Sie?'],
  })
  bulletPoints: string[];

  @ApiPropertyOptional({
    description: 'Closing reminder shown below the bullet points',
    example: 'Vergessen Sie nicht Datum und Anrede.',
  })
  closingReminder?: string;
}
