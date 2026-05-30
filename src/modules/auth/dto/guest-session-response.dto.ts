import { ApiProperty } from '@nestjs/swagger';

/**
 * Response shape for POST /api/auth/guest.
 * Frontend stores accessToken and uses isGuest to decide when to show the waitlist popup.
 */
export class GuestSessionResponseDto {
  @ApiProperty({
    description: 'Short-lived (2h) guest JWT. Send as Bearer on protected routes.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;

  @ApiProperty({
    description: 'Always true for this endpoint; lets the client flag the demo session.',
    example: true,
  })
  isGuest: true;

  @ApiProperty({
    description: 'Token lifetime in seconds (7200 = 2 hours).',
    example: 7200,
  })
  expiresIn: number;
}
