import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

export interface GooglePayload {
  sub: string;
  email: string;
  email_verified: boolean;
  given_name?: string;
  family_name?: string;
}

@Injectable()
export class GoogleService {
  private readonly client: OAuth2Client;

  constructor(private readonly config: ConfigService) {
    this.client = new OAuth2Client(
      this.config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
    );
  }

  async verifyIdToken(idToken: string): Promise<GooglePayload> {
    try {
      const audience = this.config.getOrThrow<string>('GOOGLE_CLIENT_ID');
      const ticket = await this.client.verifyIdToken({ idToken, audience });
      const payload = ticket.getPayload();

      if (!payload?.email || !payload?.sub) {
        throw new Error('INVALID_GOOGLE_PAYLOAD');
      }

      return {
        sub: payload.sub,
        email: payload.email.toLowerCase().trim(),
        email_verified: payload.email_verified ?? false,
        given_name: payload.given_name,
        family_name: payload.family_name,
      };
    } catch {
      throw new UnauthorizedException('INVALID_GOOGLE_TOKEN');
    }
  }
}