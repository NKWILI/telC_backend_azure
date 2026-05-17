import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class TokenCryptoService {
  constructor(private readonly config: ConfigService) {}

  generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  generateNumericCode(length: number): string {
    const max = 10 ** length;
    return crypto.randomInt(0, max).toString().padStart(length, '0');
  }

  hashToken(raw: string): string {
    return crypto
      .createHmac('sha256', this.config.getOrThrow<string>('TOKEN_HMAC_SECRET'))
      .update(raw)
      .digest('hex');
  }

  isExpired(date: Date): boolean {
    return date.getTime() < Date.now();
  }
}