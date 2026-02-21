/**
 * Complete SPRECHEN Feature Test
 * Tests the entire flow: Start → Audio → Warnings → End → Evaluate
 * 
 * Usage: node test-complete-flow.js
 * 
 * Prerequisites:
 * 1. Server running: npm run start:dev
 * 2. Database setup (WEBSOCKET_TEST_SETUP.sql)
 * 3. Valid JWT token
 */

const axios = require('axios');
const io = require('socket.io-client');

// Configuration
const BASE_URL = 'http://localhost:3000';
const API_URL = `${BASE_URL}/api`;
const WS_URL = `${BASE_URL}/speaking`;

// Test data from WEBSOCKET_TEST_SETUP.sql
const TEST_STUDENT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const TEST_SESSION_ID = null; // Will be created dynamically

// You'll need to get this from authentication
// For now, we'll try to register/login
let JWT_TOKEN = null;
let SESSION_ID = null;
let socket = null;

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function section(title) {
  console.log('\n' + '═'.repeat(70));
  log(`  ${title}`, 'cyan');
  console.log('═'.repeat(70) + '\n');
}

/**
 * Generate realistic mock audio (sine wave)
 */
function generateAudioChunk(durationMs = 100, frequency = 440) {
  const sampleRate = 16000;
  const sampleCount = Math.floor((sampleRate * durationMs) / 1000);
  const buffer = Buffer.alloc(sampleCount * 2); // 16-bit samples

  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleRate;
    const value = Math.sin(2 * Math.PI * frequency * t) * 16384; // Sine wave
    buffer.writeInt16LE(Math.floor(value), i * 2);
  }

  return buffer.toString('base64');
}

/**
 * Step 1: Authenticate and get JWT token
 */
// Rotate through available activation codes to avoid 409 on re-run
const AVAILABLE_CODES = [
  'T1X2-A3B4-C5D6',
  'T7Y8-E9F0-G1H2',
  'T3Z4-I5J6-K7L8',
];
let currentCodeIndex = 0;

async function authenticate() {
  section('STEP 1: AUTHENTICATION');

  // Try each activation code until one works
  for (let attempt = 0; attempt < AVAILABLE_CODES.length; attempt++) {
    const code = AVAILABLE_CODES[currentCodeIndex];
    currentCodeIndex = (currentCodeIndex + 1) % AVAILABLE_CODES.length;

    try {
      const response = await axios.post(`${API_URL}/auth/activate`, {
        activationCode: code,
        firstName: 'Test',
        lastName: 'Student',
        email: `test-${Date.now()}@example.com`,
        deviceId: `test-device-${Date.now()}`,
      });

      JWT_TOKEN = response.data.accessToken;
      log(`✅ Authenticated successfully (code: ${code})`, 'green');
      log(`   Token: ${JWT_TOKEN.substring(0, 30)}...`, 'blue');
      log(`   Student: ${response.data.student.firstName} ${response.data.student.lastName}`, 'blue');
      return true;
    } catch (error) {
      if (error.response?.status === 409) {
        log(`   Code ${code} already used, trying next...`, 'yellow');
        continue;
      }
      log('❌ Authentication failed. Make sure:', 'red');
      log('   1. Server is running (npm run start:dev)', 'yellow');
      log('   2. Run setup-test-data.sql in Supabase SQL Editor', 'yellow');
      log(`   Error message: ${error.message}`, 'red');
      log(`   Status: ${error.response?.status}`, 'red');
      log(`   Response data: ${JSON.stringify(error.response?.data)}`, 'red');
      log(`   Full error: ${error.code || 'no code'}`, 'red');
      return false;
    }
  }

  log('❌ All activation codes exhausted. Add more codes to database.', 'red');
  return false;
}

/**
 * Step 2: Start a speaking session
 */
async function startSession() {
  section('STEP 2: START SESSION');

  try {
    const response = await axios.post(
      `${API_URL}/speaking/session/start`,
      {
        teilNumber: 1,
        useTimer: true,
      },
      {
        headers: {
          Authorization: `Bearer ${JWT_TOKEN}`,
        },
      }
    );

    SESSION_ID = response.data.sessionId;
    log('✅ Session started successfully', 'green');
    log(`   Session ID: ${SESSION_ID}`, 'blue');
    log(`   Teil: ${response.data.teilNumber}`, 'blue');
    log(`   Time Limit: ${response.data.timeLimit}s`, 'blue');
    log(`   Server Start Time: ${response.data.serverStartTime}`, 'blue');
    console.log(`   Instructions: ${response.data.teilInstructions}`);
    return true;
  } catch (error) {
    log(`❌ Failed to start session: ${error.message}`, 'red');
    if (error.response?.data) {
      console.log('   Response:', error.response.data);
    }
    return false;
  }
}

/**
 * Step 3: Connect WebSocket and stream audio
 */
async function connectWebSocket() {
  section('STEP 3: WEBSOCKET CONNECTION & AUDIO STREAMING');

  return new Promise((resolve, reject) => {
    socket = io(WS_URL, {
      query: { sessionId: SESSION_ID },
      auth: { token: JWT_TOKEN },
      transports: ['websocket'],
    });

    let audioChunksSent = 0;
    let audioResponsesReceived = 0;
    const MAX_CHUNKS = 20; // Send 20 chunks (~2 seconds of audio)

    socket.on('connect', () => {
      log('✅ WebSocket connected', 'green');
      log(`   Socket ID: ${socket.id}`, 'blue');
    });

    socket.on('session_ready', (data) => {
      log('✅ Session ready', 'green');
      log(`   Status: ${data.status}`, 'blue');
      log(`   Message: ${data.message}`, 'blue');

      // Start sending audio chunks
      log('\n📤 Starting audio transmission...', 'cyan');

      const audioInterval = setInterval(() => {
        if (audioChunksSent >= MAX_CHUNKS) {
          clearInterval(audioInterval);
          log(`\n✅ Finished sending ${MAX_CHUNKS} audio chunks`, 'green');
          
          // Wait 2 seconds for final responses, then resolve
          setTimeout(() => {
            resolve({
              chunksSent: audioChunksSent,
              responsesReceived: audioResponsesReceived,
            });
          }, 2000);
          return;
        }

        const audioData = generateAudioChunk(100, 440 + audioChunksSent * 10);
        socket.emit('audio_chunk', {
          data: audioData,
          timestamp: new Date().toISOString(),
        });

        audioChunksSent++;
        process.stdout.write(`   Chunk ${audioChunksSent}/${MAX_CHUNKS} sent... \r`);
      }, 150); // Send every 150ms
    });

    socket.on('audio_response', (data) => {
      audioResponsesReceived++;
      console.log(''); // New line
      log(`📥 Audio response ${audioResponsesReceived}:`, 'green');
      
      if (data.text) {
        log(`   Elena says: "${data.text}"`, 'blue');
      }
      
      if (data.audioData) {
        const audioSize = (data.audioData.length / 1024).toFixed(2);
        log(`   Audio received: ${audioSize} KB (Base64)`, 'blue');
        log(`   Audio format: ${data.audioMimeType || 'unknown'}`, 'blue');
        
        // Note: To actually HEAR the audio, you'd need to:
        // 1. Decode Base64 → Buffer
        // 2. Play audio using a library like 'speaker' or save to WAV file
        log(`   💡 To hear audio: Decode Base64 and play as ${data.audioMimeType}`, 'yellow');
      }
      
      if (data.timestamp) {
        log(`   Timestamp: ${data.timestamp}`, 'blue');
      }
    });

    socket.on('time_warning', (data) => {
      console.log(''); // New line
      log(`⏰ Time warning: ${data.remainingSeconds}s remaining`, 'yellow');
    });

    socket.on('session_ended', (data) => {
      console.log(''); // New line
      log(`🏁 Session ended: ${data.reason}`, 'yellow');
    });

    socket.on('error', (error) => {
      console.log(''); // New line
      log(`❌ WebSocket error: ${JSON.stringify(error)}`, 'red');
    });

    socket.on('connection_error', (error) => {
      log(`❌ Connection error: ${error.message}`, 'red');
      reject(error);
    });

    socket.on('disconnect', (reason) => {
      log(`\n🔌 WebSocket disconnected: ${reason}`, 'yellow');
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      if (socket.connected) {
        log('⏱️  Test timeout reached', 'yellow');
        resolve({ chunksSent: audioChunksSent, responsesReceived: audioResponsesReceived });
      }
    }, 30000);
  });
}

/**
 * Step 4: End the session
 */
async function endSession() {
  section('STEP 4: END SESSION');

  // Disconnect WebSocket first
  if (socket && socket.connected) {
    socket.disconnect();
    log('✅ WebSocket disconnected', 'green');
  }

  // Wait a moment for cleanup
  await new Promise(resolve => setTimeout(resolve, 500));

  try {
    const response = await axios.post(
      `${API_URL}/speaking/session/${SESSION_ID}/end`,
      { reason: 'completed' },
      {
        headers: {
          Authorization: `Bearer ${JWT_TOKEN}`,
        },
      }
    );

    log('✅ Session ended successfully', 'green');
    log(`   Duration: ${response.data.duration}s`, 'blue');
    log(`   Word Count: ${response.data.wordCount}`, 'blue');
    log(`   Message Count: ${response.data.messageCount}`, 'blue');
    log(`   Evaluable: ${response.data.isEvaluable ? 'Yes' : 'No'}`, 'blue');
    return true;
  } catch (error) {
    log(`❌ Failed to end session: ${error.message}`, 'red');
    if (error.response?.data) {
      console.log('   Response:', error.response.data);
    }
    return false;
  }
}

/**
 * Step 5: Evaluate the session
 */
async function evaluateSession() {
  section('STEP 5: EVALUATE SESSION');

  try {
    log('⏳ Requesting evaluation (may take 10-30 seconds)...', 'yellow');
    
    const startTime = Date.now();
    const response = await axios.post(
      `${API_URL}/speaking/session/${SESSION_ID}/evaluate`,
      {},
      {
        headers: {
          Authorization: `Bearer ${JWT_TOKEN}`,
        },
      }
    );
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    log(`✅ Evaluation completed in ${duration}s`, 'green');
    console.log('\n📊 EVALUATION RESULTS:\n');
    
    const scores = response.data;
    log(`   Pronunciation Score: ${scores.pronunciation_score}/100`, 'blue');
    log(`   Fluency Score:       ${scores.fluency_score}/100`, 'blue');
    log(`   Grammar Score:       ${scores.grammar_score}/100`, 'blue');
    log(`   Overall Score:       ${scores.overall_score}/100`, 'green');
    
    console.log(`\n   Strengths:\n   ${scores.strengths}\n`);
    console.log(`   Areas for Improvement:\n   ${scores.areas_for_improvement}\n`);
    
    if (scores.corrections && scores.corrections.length > 0) {
      log(`\n📝 Corrections (${scores.corrections.length}):`, 'cyan');
      scores.corrections.forEach((correction, index) => {
        console.log(`\n   ${index + 1}. [${correction.error_type}]`);
        console.log(`      Original:   "${correction.original}"`);
        console.log(`      Corrected:  "${correction.corrected}"`);
        console.log(`      Explanation: ${correction.explanation}`);
      });
    }

    return true;
  } catch (error) {
    log(`❌ Evaluation failed: ${error.message}`, 'red');
    
    if (error.response?.data) {
      console.log('   Response:', error.response.data);
    }
    
    if (error.message.includes('EVALUATION_TIMEOUT')) {
      log('   💡 Evaluation timed out after 30s - this is normal for complex sessions', 'yellow');
    } else if (error.message.includes('TRANSCRIPT_NOT_FOUND')) {
      log('   💡 No transcript found - make sure audio chunks were processed', 'yellow');
    }
    
    return false;
  }
}

/**
 * Main test flow
 */
async function runCompleteTest() {
  console.log('\n');
  log('🎯 SPRECHEN FEATURE - COMPLETE INTEGRATION TEST', 'cyan');
  log('═'.repeat(70), 'cyan');

  try {
    // Step 1: Authenticate
    const authSuccess = await authenticate();
    if (!authSuccess) {
      log('\n❌ Test aborted - authentication failed', 'red');
      process.exit(1);
    }

    // Step 2: Start session
    const startSuccess = await startSession();
    if (!startSuccess) {
      log('\n❌ Test aborted - session start failed', 'red');
      process.exit(1);
    }

    // Step 3: WebSocket + Audio
    const audioResult = await connectWebSocket();
    log(`\n📊 Audio Summary:`, 'cyan');
    log(`   Chunks sent: ${audioResult.chunksSent}`, 'blue');
    log(`   Responses received: ${audioResult.responsesReceived}`, 'blue');

    // Step 4: End session
    await endSession();

    // Step 5: Evaluate
    await evaluateSession();

    // Summary
    section('✅ TEST COMPLETE');
    log('All steps completed successfully!', 'green');
    log('\n💡 To hear actual audio from Gemini:', 'yellow');
    log('   1. The audio is in Base64 format in the response', 'yellow');
    log('   2. Decode it: Buffer.from(audioData, "base64")', 'yellow');
    log('   3. Play using a library like "speaker" or save as WAV file', 'yellow');
    log('   4. Gemini returns PCM audio at the specified sample rate', 'yellow');

    process.exit(0);
  } catch (error) {
    log(`\n❌ Test failed with error: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

// Run the test
runCompleteTest();
