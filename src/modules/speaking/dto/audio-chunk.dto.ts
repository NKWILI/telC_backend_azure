import { IsString, IsISO8601 } from 'class-validator';
import { IsBase64 } from '../../../shared/decorators/is-base64.decorator';

export class AudioChunkDto {
  @IsString()
  @IsBase64({ message: 'Audio data must be valid Base64 encoded' })
  data: string; // Base64-encoded PCM audio data

  @IsISO8601()
  timestamp: string; // Client timestamp for latency debugging (ISO 8601 format)
}
