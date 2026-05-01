import { AuthStudentResponse } from '../../../shared/interfaces/student.interface';

export interface AuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  student: AuthStudentResponse;
}