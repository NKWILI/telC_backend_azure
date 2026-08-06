export interface AccessTokenPayload {
  type: 'access';
  studentId: string;
  deviceId: string;
  isGuest?: boolean;
  iat?: number;
  exp?: number;
}

export interface RefreshTokenPayload {
  type: 'refresh';
  studentId: string;
  deviceId: string;
  sessionId: string;
  iat?: number;
  exp?: number;
}

export interface LinkingTokenPayload {
  type: 'linking';
  email: string;
  provider: string;
  providerId: string;
  iat?: number;
  exp?: number;
}
