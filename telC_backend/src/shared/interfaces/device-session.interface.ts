export interface DeviceSession {
  id: string;
  student_id: string;
  device_id: string;
  refresh_token_hash: string;
  device_name: string | null;
  last_used_at: string;
  created_at: string;
  revoked_at: string | null;
}
