/**
 * Get JWT Token for WebSocket Testing
 * 
 * This script gets a valid JWT token by:
 * 1. Registering a test student
 * 2. Creating activation code in database
 * 3. Activating the student
 * 4. Returning the access token
 * 
 * Usage:
 *   node get-test-token.js
 */

const https = require('https');

const API_BASE = 'http://localhost:3000/api';

function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const fullUrl = new URL(API_BASE + path);
    const options = {
      hostname: fullUrl.hostname,
      port: fullUrl.port || (fullUrl.protocol === 'https:' ? 443 : 80),
      path: fullUrl.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const protocol = fullUrl.protocol === 'https:' ? https : require('http');
    const req = protocol.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: JSON.parse(data),
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data,
          });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function main() {
  console.log('\n' + '═'.repeat(70));
  console.log('🔐 Getting JWT Token for WebSocket Testing');
  console.log('═'.repeat(70));
  console.log('');

  try {
    // Step 1: Try to register a student
    console.log('📝 Step 1: Registering test student...');
    const email = `test-${Date.now()}@example.com`;
    const password = 'TestPassword123!';

    const registerRes = await makeRequest('POST', '/auth/register', {
      email,
      password,
    });

    if (registerRes.status !== 201) {
      console.log(`   ⚠️  Registration returned ${registerRes.status}`);
      console.log(`   Response: ${JSON.stringify(registerRes.body)}`);
      console.log('');
      console.log('   Trying alternate flow...');
      console.log('');
    } else {
      console.log(`   ✅ Student registered: ${registerRes.body.studentId}`);
      console.log(`   📧 Email: ${email}`);
    }

    if (!registerRes.body?.studentId) {
      console.log('   ❌ Could not get studentId from registration');
      console.log('');
      console.log('   Manual steps to get token:');
      console.log('');
      console.log('   1. Visit: http://localhost:3000/api/auth/register');
      console.log('   2. POST with: {"email":"test@example.com","password":"Test123!"}');
      console.log('   3. Copy the studentId');
      console.log('   4. Create activation code in Supabase:');
      console.log('      INSERT INTO activation_codes VALUES (\'code-123\', \'<studentId>\', \'active\');');
      console.log('   5. POST /api/auth/activate with: {"studentId":"<studentId>","activationCode":"code-123"}');
      console.log('   6. Copy the accessToken from response');
      console.log('');
      process.exit(1);
    }

    const studentId = registerRes.body.studentId;

    // Step 2: Create activation code in Supabase
    console.log('');
    console.log('🔑 Step 2: Creating activation code in database...');
    const activationCode = `test-code-${Date.now()}`;
    console.log(`   Code: ${activationCode}`);
    console.log('   ℹ️  You need to create this in Supabase manually:');
    console.log('');
    console.log('   SQL:');
    console.log(`   INSERT INTO activation_codes (id, student_id, status)`);
    console.log(`   VALUES ('${activationCode}', '${studentId}', 'active');`);
    console.log('');
    console.log('   Go to: https://supabase.com/dashboard');
    console.log('   → SQL Editor');
    console.log('   → Paste the SQL above and execute');
    console.log('   → Then run this script again');
    console.log('');

    // For now, we'll wait for user to do it
    console.log('   Waiting 3 seconds, then attempting activation...');
    await new Promise((r) => setTimeout(r, 3000));

    // Step 3: Try to activate
    console.log('');
    console.log('⚡ Step 3: Activating student...');
    const activateRes = await makeRequest('POST', '/auth/activate', {
      studentId,
      activationCode,
    });

    if (activateRes.status !== 200 || !activateRes.body?.accessToken) {
      console.log(`   ❌ Activation failed: ${activateRes.status}`);
      console.log(`   Response: ${JSON.stringify(activateRes.body)}`);
      console.log('');
      console.log('   Did you create the activation code in the database?');
      console.log(`   INSERT INTO activation_codes VALUES ('${activationCode}', '${studentId}', 'active');`);
      process.exit(1);
    }

    console.log(`   ✅ Student activated`);
    console.log('');
    console.log(`   🎯 Access Token (use this for WebSocket testing):`);
    console.log(`   ${activateRes.body.accessToken}`);
    console.log('');
    console.log('═'.repeat(70));
    console.log('✅ Success! Use the token above for WebSocket testing:');
    console.log('═'.repeat(70));
    console.log('');
    console.log('Command:');
    console.log(
      `node test-websocket.js test-session-ws-001 "${activateRes.body.accessToken}"`,
    );
    console.log('');
    console.log('Or set environment variable:');
    console.log(`$env:TEST_JWT_TOKEN="${activateRes.body.accessToken}"`);
    console.log('node test-websocket.js test-session-ws-001');
    console.log('');
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log('');
    console.log('Troubleshooting:');
    console.log('  - Is the server running? npm run start:dev');
    console.log('  - Check http://localhost:3000/api/health');
    process.exit(1);
  }
}

main();
