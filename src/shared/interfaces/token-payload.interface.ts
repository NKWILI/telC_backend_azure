export interface AccessTokenPayload {
  studentId: string;
  deviceId: string;
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
