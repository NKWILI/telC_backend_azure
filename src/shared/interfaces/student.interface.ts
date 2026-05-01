export interface Student {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

export interface AuthStudentResponse {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  emailVerified: boolean;
}
