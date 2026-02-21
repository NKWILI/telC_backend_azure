import { IsNumber, IsString, IsBoolean, IsISO8601 } from 'class-validator';

export class StartSessionResponseDto {
  @IsString()
  sessionId: string;

  @IsNumber()
  teilNumber: number;

  @IsBoolean()
  useTimer: boolean;

  @IsISO8601()
  serverStartTime: string; // ISO 8601 timestamp

  @IsNumber()
  timeLimit: number | null; // seconds, or null if useTimer is false

  @IsString()
  teilInstructions: string; // What to expect in this Teil
}

export class SessionSummaryDto {
  @IsNumber()
  duration: number; // Total duration in seconds

  @IsNumber()
  wordCount: number; // Number of words spoken by student

  @IsNumber()
  messageCount: number; // Number of exchanges (Q&A pairs)

  @IsBoolean()
  isEvaluable: boolean; // True if enough data to evaluate
}

export class PauseSessionResponseDto {
  @IsString()
  status: 'paused';

  @IsISO8601()
  pausedAt: string;

  @IsNumber()
  elapsedSeconds: number;

  @IsNumber()
  remainingSeconds: number | null;
}

export class ResumeSessionResponseDto {
  @IsString()
  status: 'active';

  @IsISO8601()
  resumedAt: string;

  @IsNumber()
  remainingSeconds: number | null;
}

export class EndSessionResponseDto extends SessionSummaryDto {}
