/**
 * Response body for POST /api/writing/submit (201 Created).
 */
export interface SubmitWritingResponseDto {
  attemptId: string;
  status: string;
  message?: string;
}
