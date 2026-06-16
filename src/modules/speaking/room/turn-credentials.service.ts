import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { IceServerDto, IceServersResponseDto } from './dto/ice-servers-response.dto';

const DEFAULT_STUN_URLS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
];
const DEFAULT_TTL_SECONDS = 3600;

/**
 * Issues WebRTC ICE servers for the Sprechen Room.
 *
 * TURN credentials use the coturn `use-auth-secret` (TURN REST API) scheme:
 *   username   = "<expiryUnixSeconds>:<studentId>"
 *   credential = base64( HMAC_SHA1( TURN_STATIC_AUTH_SECRET, username ) )
 * The same static secret is configured on the coturn server, so no runtime call
 * to the TURN server is needed — credentials are computed locally and expire after
 * `TURN_CREDENTIAL_TTL_SECONDS`.
 *
 * When TURN is disabled or unconfigured, returns STUN-only (the frontend falls back
 * to STUN), so the endpoint is safe to ship before the TURN infra is live.
 */
@Injectable()
export class TurnCredentialsService {
  private readonly logger = new Logger(TurnCredentialsService.name);

  constructor(private readonly config: ConfigService) {}

  getIceServers(studentId: string): IceServersResponseDto {
    const ttlSeconds =
      Number(this.config.get<string>('TURN_CREDENTIAL_TTL_SECONDS')) ||
      DEFAULT_TTL_SECONDS;

    const stunUrls = this.parseList(this.config.get<string>('STUN_URLS')) ?? DEFAULT_STUN_URLS;
    const iceServers: IceServerDto[] = stunUrls.map((urls) => ({ urls }));

    const enabled = this.config.get<string>('TURN_ENABLED') === 'true';
    const secret = this.config.get<string>('TURN_STATIC_AUTH_SECRET');
    const turnUrls = this.parseList(this.config.get<string>('TURN_URLS')) ?? [];

    if (enabled && secret && turnUrls.length > 0) {
      const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
      const username = `${expiry}:${studentId}`;
      const credential = createHmac('sha1', secret).update(username).digest('base64');

      for (const urls of turnUrls) {
        iceServers.push({ urls, username, credential, credentialType: 'password' });
      }
    } else {
      this.logger.warn('TURN disabled or unconfigured — returning STUN-only ICE servers');
    }

    return { iceServers, ttlSeconds };
  }

  private parseList(value?: string): string[] | undefined {
    if (!value) return undefined;
    const items = value.split(',').map((s) => s.trim()).filter(Boolean);
    return items.length > 0 ? items : undefined;
  }
}
