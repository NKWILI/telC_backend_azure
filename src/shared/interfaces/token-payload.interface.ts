export interface AccessTokenPayload {
  type: 'access';
  studentId: string;
  deviceId: string;
  sessionId?: string;
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

export interface CenterAccessTokenPayload {
  type: 'access';
  actorType: 'CENTER_USER';
  centerUserId: string;
  centerId: string;
  deviceId: string;
  sessionId: string;
  iat?: number;
  exp?: number;
}

export interface CenterRefreshTokenPayload {
  type: 'refresh';
  actorType: 'CENTER_USER';
  centerUserId: string;
  centerId: string;
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
