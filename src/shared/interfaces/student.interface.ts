export interface Student {
  id: string;
  activation_code: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  is_registered: boolean;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}
