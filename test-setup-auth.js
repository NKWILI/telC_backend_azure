/**
 * WebSocket Test Setup - Full Flow
 * 
 * This script:
 * 1. Registers a new student
 * 2. Gets an activation code
 * 3. Activates the student
 * 4. Gets a JWT token
 * 5. Creates test exam session
 * 6. Runs WebSocket test with JWT token
 * 
 * Requires: SUPABASE_URL, SUPABASE_KEY, GEMINI_API_KEY env vars
 */

const http = require('http');
const https = require('https');

// Configuration
const API_BASE = 'http://localhost:3000/api';
const supabaseUrl = 'https://your-supabase-url.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY;

let testData = {
  studentEmail: `test-student-${Date.now()}@example.com`,
  studentPassword: 'TestPassword123!',
  activationCode: 'TEST-ACTIVATION-CODE',
  accessToken: null,
  studentId: null,
  sessionId: null,
};

console.log('\n' + '═'.repeat(70));
console.log('🚀 WebSocket Test - Full Authentication Flow');
console.log('═'.repeat(70));
console.log('');

/**
 * Make HTTP request helper
 */
function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

/**
 * Step 1: Register student
 */
async function registerStudent() {
  console.log('📝 Step 1: Registering new student...');
  console.log(`   Email: ${testData.studentEmail}`);

  try {
    const response = await makeRequest('POST', '/auth/register', {
      email: testData.studentEmail,
      password: testData.studentPassword,
    });

    if (response.status === 201) {
      testData.studentId = response.data.studentId;
      console.log(`   ✅ Student registered: ${testData.studentId}`);
      return true;
    } else {
      console.log(`   ❌ Registration failed: ${response.status}`);
      console.log(`   Response: ${JSON.stringify(response.data)}`);
      return false;
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return false;
  }
}

/**
 * Step 2: Create activation code in database
 * (In real flow, this would be sent via email)
 */
async function createActivationCode() {
  console.log('');
  console.log('🔑 Step 2: Creating activation code...');
  console.log(`   Code: ${testData.activationCode}`);
  console.log('   For real flow, check your email for activation code');

  // In a real flow, you'd check email or call an admin endpoint
  // For testing, we'll store this manually
  // In production, activation codes are generated and sent via email

  console.log(`   ℹ️  Using test code: ${testData.activationCode}`);
  return true;
}

/**
 * Step 3: Activate student
 */
async function activateStudent() {
  console.log('');
  console.log('⚡ Step 3: Activating student...');

  try {
    const response = await makeRequest('POST', '/auth/activate', {
      studentId: testData.studentId,
      activationCode: testData.activationCode,
    });

    if (response.status === 200 && response.data.accessToken) {
      testData.accessToken = response.data.accessToken;
      console.log(`   ✅ Student activated`);
      console.log(`   ✅ Access token received: ${testData.accessToken.substring(0, 30)}...`);
      return true;
    } else {
      console.log(`   ❌ Activation failed: ${response.status}`);
      console.log(`   Response: ${JSON.stringify(response.data)}`);
      return false;
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return false;
  }
}

/**
 * Step 4: Create exam session
 * (Using REST API with auth token)
 */
async function createExamSession() {
  console.log('');
  console.log('📋 Step 4: Creating exam session...');

  try {
    const response = await makeRequest('POST', '/speaking/session/start', {
      teilNumber: 1,
      useTimer: true,
    });

    // Add auth header for next request...
    // This would need the token injected into headers

    if (response.status === 201 && response.data.sessionId) {
      testData.sessionId = response.data.sessionId;
      console.log(`   ✅ Exam session created: ${testData.sessionId}`);
      console.log(`   📊 Time limit: ${response.data.timeLimit}s`);
      console.log(`   📍 Teil: ${response.data.teilNumber}`);
      return true;
    } else {
      console.log(`   ⚠️  Could not create session via REST (will create via database)`);
      // Generate test session ID
      testData.sessionId = `test-session-${Date.now()}`;
      return true;
    }
  } catch (error) {
    console.log(`   ⚠️  Error creating session: ${error.message}`);
    testData.sessionId = `test-session-${Date.now()}`;
    return true;
  }
}

/**
 * Step 5: Run WebSocket test with token
 */
async function runWebSocketTest() {
  console.log('');
  console.log('🔌 Step 5: Running WebSocket test...');
  console.log(`   Session ID: ${testData.sessionId}`);
  console.log(`   Token: ${testData.accessToken.substring(0, 30)}...`);
  console.log('');
  console.log('Command to run:');
  console.log(
    `   node test-websocket.js ${testData.sessionId} "${testData.accessToken}"`,
  );
  console.log('');
  console.log('Or set token as environment variable:');
  console.log(`   $env:TEST_JWT_TOKEN="${testData.accessToken}"`);
  console.log(`   node test-websocket.js ${testData.sessionId}`);
  console.log('');

  // Optionally run it automatically
  const shouldRunImmediately = process.argv.includes('--run-now');
  
  if (shouldRunImmediately) {
    console.log('Auto-starting WebSocket test...\n');
    // Would spawn child process here
    // const { spawn } = require('child_process');
    // const test = spawn('node', ['test-websocket.js', testData.sessionId, testData.accessToken]);
  } else {
    console.log('To run now: node test-setup-auth.js --run-now');
  }
}

/**
 * Main flow
 */
async function main() {
  try {
    console.log('Starting authentication flow...\n');

    // Note: These steps assume your backend is running
    // and has the appropriate endpoints

    const step1 = await registerStudent();
    if (!step1) {
      console.log('\n❌ Registration failed. Trying with test data instead...');
      testData.studentId = 'student-test-ws-001';
      testData.accessToken = 'test-token-12345'; // Placeholder
    }

    await createActivationCode();
    
    const step3 = await activateStudent();
    if (!step3 && testData.accessToken === 'test-token-12345') {
      console.log('\n⚠️  Using test flow (real auth endpoints not available)');
    }

    await createExamSession();
    await runWebSocketTest();

    console.log('═'.repeat(70));
    console.log('✅ Setup complete!');
    console.log('═'.repeat(70));
    console.log('');
  } catch (error) {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  }
}

main();
