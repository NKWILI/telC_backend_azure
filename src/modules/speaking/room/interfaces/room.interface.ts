export interface RoomGuest {
  displayName: string;
  socketId: string;
}

export interface Room {
  roomId: string;
  /** Read aloud and typed to join (D32). Freed when the room goes. */
  shortCode: string;
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
