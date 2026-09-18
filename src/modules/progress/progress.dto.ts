import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const SKILL_NOTE = 'Null = not practised yet. Show that, never "0 %".';

export class SkillScoresDto {
  @ApiPropertyOptional({ nullable: true, example: 72, description: SKILL_NOTE })
  hoeren: number | null;
  @ApiPropertyOptional({ nullable: true, example: 64 }) lesen: number | null;
  @ApiPropertyOptional({ nullable: true, example: 58 })
  sprachbausteine: number | null;
  @ApiPropertyOptional({ nullable: true, example: 80 })
  schreiben: number | null;
  @ApiPropertyOptional({ nullable: true, example: null })
  sprechen: number | null;
}

export class ReadinessDto {
  @ApiPropertyOptional({
    nullable: true,
    example: 62,
    description:
      'Estimated exam readiness, 0–100: the written part (4 skills) and the oral part (Sprechen), weighted by the exam. Null under 5 attempts: show "not enough exercises yet". An estimate, never a promise of passing.',
  })
  score: number | null;

  @ApiPropertyOptional({ nullable: true, example: 68 }) written: number | null;
  @ApiPropertyOptional({ nullable: true, example: 45 }) oral: number | null;

  @ApiProperty({
    example: false,
    description: 'Written and oral each at 60 or more, as telc requires.',
  })
  ready: boolean;
}

export class ProgressAlertDto {
  @ApiProperty({ enum: ['inactive', 'low_progress', 'weak_skill'] })
  type: 'inactive' | 'low_progress' | 'weak_skill';

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    format: 'date-time',
    description: '`inactive` only: the last activity, null if never.',
  })
  lastActivityAt?: string | null;

  @ApiPropertyOptional({ description: '`low_progress` only' })
  readiness?: number;

  @ApiPropertyOptional({
    enum: ['hoeren', 'lesen', 'sprachbausteine', 'schreiben', 'sprechen'],
    description: '`weak_skill` only',
  })
  skill?: string;

  @ApiPropertyOptional({ description: '`weak_skill` only' })
  score?: number;
}

export class StudentProgressDto {
  @ApiProperty({ type: SkillScoresDto }) skills: SkillScoresDto;
  @ApiProperty({ type: ReadinessDto }) readiness: ReadinessDto;
  @ApiProperty({ example: 23, description: 'Completed attempts, all skills.' })
  attempts: number;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  lastActivityAt: string | null;

  @ApiProperty({
    type: [ProgressAlertDto],
    description:
      'inactive: nothing for 7 days; low_progress: readiness under 40; weak_skill: a practised skill under 45.',
  })
  alerts: ProgressAlertDto[];
}

export class MyProgressDto extends StudentProgressDto {
  @ApiPropertyOptional({
    nullable: true,
    enum: ['A1', 'A2', 'B1', 'B2'],
    description:
      'Current level, set by the student or their center. The target is always telc B1+ Beruf.',
  })
  level: 'A1' | 'A2' | 'B1' | 'B2' | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 4,
    description:
      'Readiness now minus readiness on the activity up to 7 days ago. Null while either is unknown.',
  })
  weeklyChange: number | null;
}

class CenterAlertCountsDto {
  @ApiProperty() inactive: number;
  @ApiProperty() lowProgress: number;
  @ApiProperty() weakSkill: number;
}

export class CenterProgressSummaryDto {
  @ApiProperty({ example: 18 }) students: number;

  @ApiPropertyOptional({
    nullable: true,
    example: 57,
    description:
      'Mean readiness of the students who have one. The dashboard "Average progress".',
  })
  averageReadiness: number | null;

  @ApiProperty({ example: 4, description: 'Students ready for the exam.' })
  ready: number;

  @ApiProperty({
    type: SkillScoresDto,
    description: 'Mean of each skill across the students who practised it.',
  })
  skillAverages: SkillScoresDto;

  @ApiProperty({
    type: CenterAlertCountsDto,
    description: 'How many students have each alert.',
  })
  alerts: CenterAlertCountsDto;
}
