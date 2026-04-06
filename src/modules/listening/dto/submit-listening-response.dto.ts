/**
 * Response body for POST /api/listening/submit.
 * Frontend parses with ListeningSubmitResult.fromJson — accepts "score" or "note".
 */
export interface SubmitListeningResponseDto {
  score: number;
}
