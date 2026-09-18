export interface Student {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  email_verified: boolean;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
  level?: 'A1' | 'A2' | 'B1' | 'B2' | null;
}

export interface AuthStudentResponse {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  emailVerified: boolean;
}
