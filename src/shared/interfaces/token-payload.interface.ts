export interface AccessTokenPayload {
  studentId: string;
  deviceId: string;
  isGuest?: boolean;
  iat?: number;
  exp?: number;
}

export interface RefreshTokenPayload {
  studentId: string;
  deviceId: string;
  sessionId: string;
  iat?: number;
  exp?: number;
}

export interface LinkingTokenPayload {
  email: string;
  provider: string;
  providerId: string;
  iat?: number;
  exp?: number;
}
