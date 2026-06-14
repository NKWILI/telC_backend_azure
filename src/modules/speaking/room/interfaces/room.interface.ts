export interface RoomGuest {
  displayName: string;
  socketId: string;
}

export interface Room {
  roomId: string;
  hostSocketId: string | null;
  hostToken: string;
  guest: RoomGuest | null;
  status: 'waiting' | 'active' | 'ended';
  createdAt: Date;
  /** Set at createRoom() as createdAt + 2 hours. Source of truth for both DTOs. */
  expiresAt: Date;
  expiryTimer: NodeJS.Timeout;
  gracePeriodTimer: NodeJS.Timeout | null;
}
