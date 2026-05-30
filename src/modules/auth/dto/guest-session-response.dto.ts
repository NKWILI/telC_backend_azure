/**
 * Response shape for POST /api/auth/guest.
 * Frontend stores accessToken and uses isGuest to decide when to show the waitlist popup.
 */
export class GuestSessionResponseDto {
  accessToken: string;
  isGuest: true;
  expiresIn: number;
}
