import { TurnCredentialsService } from '../src/modules/speaking/room/turn-credentials.service';

// Mock ConfigService: get(key) returns the mapped value.
function makeConfig(map: Record<string, string | undefined>) {
  return { get: jest.fn((k: string) => map[k]) } as any;
}

describe('TurnCredentialsService', () => {
  // 1_700_000_000_000 ms → 1_700_000_000 s; +3600 ttl → expiry 1_700_003_600
  const NOW_MS = 1_700_000_000_000;
  const SECRET = 'test-secret-123';
  // Independently computed: base64(HMAC_SHA1(SECRET, "1700003600:student-42"))
  const KNOWN_CREDENTIAL = 'LE8aOHNDVWy52ClV9vpQYE5Aq2I=';

  let nowSpy: jest.SpyInstance;

  beforeEach(() => {
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW_MS);
  });

  afterEach(() => {
    nowSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('returns STUN-only when TURN_ENABLED is not "true"', () => {
    const svc = new TurnCredentialsService(
      makeConfig({
        TURN_ENABLED: 'false',
        TURN_URLS: 'turn:1.2.3.4:3478?transport=udp',
        TURN_STATIC_AUTH_SECRET: SECRET,
      }),
    );

    const res = svc.getIceServers('student-42');

    expect(res.iceServers.length).toBeGreaterThan(0);
    expect(res.iceServers.every((s) => s.urls.startsWith('stun:'))).toBe(true);
    expect(res.iceServers.some((s) => s.urls.startsWith('turn:'))).toBe(false);
  });

  it('returns STUN-only when the secret is missing even if enabled', () => {
    const svc = new TurnCredentialsService(
      makeConfig({
        TURN_ENABLED: 'true',
        TURN_URLS: 'turn:1.2.3.4:3478?transport=udp',
        TURN_STATIC_AUTH_SECRET: undefined,
      }),
    );

    const res = svc.getIceServers('student-42');

    expect(res.iceServers.some((s) => s.urls.startsWith('turn:'))).toBe(false);
  });

  it('mints ephemeral TURN credentials when enabled (one entry per URL)', () => {
    const svc = new TurnCredentialsService(
      makeConfig({
        TURN_ENABLED: 'true',
        TURN_URLS:
          'turn:64.226.72.102:3478?transport=udp,turn:64.226.72.102:3478?transport=tcp',
        TURN_STATIC_AUTH_SECRET: SECRET,
        TURN_CREDENTIAL_TTL_SECONDS: '3600',
      }),
    );

    const res = svc.getIceServers('student-42');
    const turns = res.iceServers.filter((s) => s.urls.startsWith('turn:'));

    expect(turns).toHaveLength(2);
    expect(turns[0].username).toBe('1700003600:student-42');
    expect(turns[0].credential).toBe(KNOWN_CREDENTIAL);
    expect(turns[0].credentialType).toBe('password');
    expect(res.ttlSeconds).toBe(3600);
  });

  it('username is "<expiry>:<studentId>" with expiry = now + ttl', () => {
    const svc = new TurnCredentialsService(
      makeConfig({
        TURN_ENABLED: 'true',
        TURN_URLS: 'turn:x:3478',
        TURN_STATIC_AUTH_SECRET: SECRET,
        TURN_CREDENTIAL_TTL_SECONDS: '3600',
      }),
    );

    const res = svc.getIceServers('abc');
    const turn = res.iceServers.find((s) => s.urls.startsWith('turn:'))!;

    expect(turn.username).toBe(`${1_700_000_000 + 3600}:abc`);
  });

  it('defaults TTL to 3600 when not configured', () => {
    const svc = new TurnCredentialsService(makeConfig({ TURN_ENABLED: 'false' }));

    const res = svc.getIceServers('abc');

    expect(res.ttlSeconds).toBe(3600);
  });

  it('always includes at least one STUN server', () => {
    const svc = new TurnCredentialsService(makeConfig({ TURN_ENABLED: 'false' }));

    const res = svc.getIceServers('abc');

    expect(res.iceServers.some((s) => s.urls.startsWith('stun:'))).toBe(true);
  });
});
