-- ============================================================
-- WebSocket Test Data Setup
-- Run this script in your Supabase SQL Editor
-- ============================================================

-- 1. Create test student (if doesn't exist)
INSERT INTO students (id, name, email)
VALUES (
  'student-test-ws-001',
  'WebSocket Test Student',
  'ws-test@example.com'
)
ON CONFLICT (id) DO UPDATE SET
  name = 'WebSocket Test Student',
  email = 'ws-test@example.com';

-- 2. Create active activation code for test student
INSERT INTO activation_codes (id, student_id, status, created_at)
VALUES (
  'code-ws-test-001',
  'student-test-ws-001',
  'active',
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  status = 'active',
  updated_at = NOW();

-- 3. Create active exam session for WebSocket testing (Teil 1)
INSERT INTO exam_sessions (
  id,
  student_id,
  teil_number,
  status,
  use_timer,
  server_start_time,
  elapsed_time,
  created_at
) VALUES (
  'test-session-ws-001',
  'student-test-ws-001',
  1,
  'active',
  true,
  NOW(),
  0,
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  student_id = 'student-test-ws-001',
  status = 'active',
  server_start_time = NOW(),
  elapsed_time = 0,
  updated_at = NOW();

-- 4. (Optional) Create exam sessions for Teil 2 and 3
INSERT INTO exam_sessions (
  id,
  student_id,
  teil_number,
  status,
  use_timer,
  server_start_time,
  elapsed_time,
  created_at
) VALUES
  (
    'test-session-ws-002',
    'student-test-ws-001',
    2,
    'active',
    true,
    NOW(),
    0,
    NOW()
  ),
  (
    'test-session-ws-003',
    'student-test-ws-001',
    3,
    'active',
    true,
    NOW(),
    0,
    NOW()
  )
ON CONFLICT (id) DO UPDATE SET
  status = 'active',
  server_start_time = NOW(),
  elapsed_time = 0,
  updated_at = NOW();

-- 5. Verify data was created
SELECT 
  s.id as student_id,
  s.name,
  s.email,
  ac.id as activation_code_id,
  ac.status as code_status,
  es.id as session_id,
  es.teil_number,
  es.status as session_status,
  es.use_timer,
  es.server_start_time
FROM students s
LEFT JOIN activation_codes ac ON s.id = ac.student_id
LEFT JOIN exam_sessions es ON s.id = es.student_id
WHERE s.id = 'student-test-ws-001'
ORDER BY es.teil_number;

-- ============================================================
-- To clean up after testing:
-- DELETE FROM exam_sessions WHERE student_id = 'student-test-ws-001';
-- DELETE FROM activation_codes WHERE student_id = 'student-test-ws-001';
-- DELETE FROM students WHERE id = 'student-test-ws-001';
-- ============================================================
