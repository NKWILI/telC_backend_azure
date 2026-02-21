/**
 * WebSocket Test Client for Speaking Gateway
 * 
 * Usage:
 *   node test-websocket.js [sessionId] [token]
 * 
 * Examples:
 *   node test-websocket.js test-session-ws-001 "eyJhbGc..."
 *   node test-websocket.js test-session-ws-001
 * 
 * To get a token:
 *   1. Register student: POST /api/auth/register
 *   2. Activate: POST /api/auth/activate with activation code
 *   3. Copy accessToken from response
 * 
 * For testing without real token, set environment variable:
 *   $env:SKIP_TOKEN_VALIDATION=true (development only)
 */

const io = require('socket.io-client');

// Configuration
const SESSION_ID = process.argv[2] || 'test-session-ws-001';
const JWT_TOKEN = process.argv[3] || process.env.TEST_JWT_TOKEN || null;
const ENDPOINT = 'http://localhost:3000/speaking';
const CHUNK_COUNT = 10;
const CHUNK_INTERVAL = 200; // milliseconds

console.log('\n' + '═'.repeat(60));
console.log('🔌 Speaking WebSocket Gateway - Test Client');
console.log('═'.repeat(60));
console.log(`📍 Endpoint: ${ENDPOINT}`);
console.log(`📌 Session ID: ${SESSION_ID}`);
console.log(`📊 Test Config: ${CHUNK_COUNT} chunks, ${CHUNK_INTERVAL}ms apart`);
console.log('═'.repeat(60) + '\n');

// Global state
let socket = null;
let chunkCount = 0;
let audioIntervalId = null;
let isConnected = false;

/**
 * Generate mock PCM audio data
 * 16-bit signed integer, 16kHz sample rate, ~100ms duration
 */
function generateMockAudioChunk() {
  const sampleCount = 1600; // 100ms at 16kHz
  const buffer = Buffer.alloc(sampleCount * 2);

  // Fill with white noise (random samples)
  for (let i = 0; i < sampleCount; i++) {
    const value = Math.floor(Math.random() * 32768) - 16384;
    buffer.writeInt16LE(value, i * 2);
  }

  return buffer.toString('base64');
}

/**
 * Log helper with timestamps
 */
function log(message, level = 'info') {
  const time = new Date().toLocaleTimeString();
  const prefix = {
    success: '✅',
    error: '❌',
    info: 'ℹ️ ',
    audio: '🎵',
    send: '📤',
    receive: '📥',
  }[level] || 'ℹ️ ';

  console.log(`[${time}] ${prefix} ${message}`);
}

/**
 * Start sending audio chunks
 */
function sendTestAudioChunks() {
  if (!isConnected) {
    log('Cannot send audio - not connected', 'error');
    return;
  }

  log(`Starting to send ${CHUNK_COUNT} audio chunks...`, 'send');
  chunkCount = 0;

  audioIntervalId = setInterval(() => {
    if (!isConnected) {
      clearInterval(audioIntervalId);
      return;
    }

    const audioData = generateMockAudioChunk();

    socket.emit('audio_chunk', {
      data: audioData,
      timestamp: new Date().toISOString(),
    });

    chunkCount++;
    log(
      `Sent audio chunk #${chunkCount}/${CHUNK_COUNT} (${(audioData.length / 1024).toFixed(2)}KB Base64)`,
      'send',
    );

    // Stop after target chunks
    if (chunkCount >= CHUNK_COUNT) {
      clearInterval(audioIntervalId);
      log(`Finished sending all ${CHUNK_COUNT} audio chunks`, 'success');

      // Close connection after brief delay
      setTimeout(() => {
        log('Disconnecting...', 'info');
        socket.disconnect();
        process.exit(0);
      }, 2000);
    }
  }, CHUNK_INTERVAL);
}

/**
 * Connect to WebSocket
 */
function connect() {
  if (!JWT_TOKEN) {
    log(
      'ERROR: No JWT token provided. Pass as 2nd argument: node test-websocket.js [sessionId] [token]',
      'error',
    );
    log('Or set environment variable: $env:TEST_JWT_TOKEN="your-token"', 'info');
    log('', 'info');
    log('To get a token:', 'info');
    log('  1. POST /api/auth/register with email/password', 'info');
    log('  2. POST /api/auth/activate with activation code', 'info');
    log('  3. Copy accessToken from response', 'info');
    process.exit(1);
  }

  log(
    `Connecting to WebSocket at ${ENDPOINT}?sessionId=${SESSION_ID}`,
    'info',
  );
  log(`Using JWT token: ${JWT_TOKEN.substring(0, 20)}...`, 'info');

  socket = io(ENDPOINT, {
    query: {
      sessionId: SESSION_ID,
    },
    auth: {
      token: JWT_TOKEN,
    },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5,
    transports: ['websocket'],
  });

  // ============ CONNECTION EVENTS ============

  socket.on('connect', () => {
    log(`Connected to WebSocket (Socket ID: ${socket.id})`, 'success');
    isConnected = true;
  });

  socket.on('connection_error', (error) => {
    log(`Connection error: ${error.message || JSON.stringify(error)}`, 'error');
    isConnected = false;
    process.exit(1);
  });

  // ============ SESSION EVENTS ============

  socket.on('session_ready', (data) => {
    log('Received session_ready event', 'success');
    console.log('  📋 Session Details:');
    console.log(`     • Session ID: ${data.sessionId}`);
    console.log(`     • Teil: ${data.teilNumber}`);
    console.log(`     • Server Start: ${data.serverStartTime}`);
    console.log(`     • Time Limit: ${data.timeLimit ? data.timeLimit + 's' : 'Unlimited'}`);
    console.log(`     • Status: ${data.status}`);
    console.log(`     • Message: ${data.message}`);
    console.log('');

    // Start sending audio after brief delay
    setTimeout(() => {
      sendTestAudioChunks();
    }, 1000);
  });

  // ============ AUDIO EVENTS ============

  socket.on('audio_response', (data) => {
    if (!data) {
      log('Received empty audio response (Gemini processing, no output yet)', 'audio');
      return;
    }

    const details = [];
    if (data.text) {
      details.push(`Text: "${data.text}"`);
    }
    if (data.audioData) {
      const audioSize = `${(data.audioData.length / 1024).toFixed(2)}KB`;
      details.push(`Audio: ${audioSize}`);
    }
    if (data.timestamp) {
      details.push(`Time: ${data.timestamp}`);
    }

    const summary = details.length > 0 ? details.join(' | ') : 'No content';
    log(`🎵 Audio response received: ${summary}`, 'audio');
  });

  socket.on('time_warning', (data) => {
    log(
      `Received time warning: ${data.remainingSeconds} seconds remaining`,
      'info',
    );
  });

  // ============ ERROR EVENTS ============

  socket.on('error', (error) => {
    log(`Socket error: ${JSON.stringify(error)}`, 'error');
  });

  socket.on('gemini_error', (error) => {
    log(
      `Gemini error (${error.code}): ${error.message}`,
      'error',
    );
    if (error.details) {
      log(`  Details: ${error.details}`, 'error');
    }
  });

  // ============ DISCONNECT EVENT ============

  socket.on('disconnect', (reason) => {
    log(`Disconnected from WebSocket (reason: ${reason})`, 'info');
    isConnected = false;
  });

  // ============ TIMEOUT SAFETY ============

  setTimeout(() => {
    if (socket && socket.connected) {
      log('Test timeout (60s) reached. Disconnecting...', 'error');
      socket.disconnect();
    }
    process.exit(0);
  }, 60000);
}

/**
 * Main entry point
 */
function main() {
  connect();

  // Graceful shutdown
  process.on('SIGINT', () => {
    log('\nReceived SIGINT, shutting down gracefully...', 'info');
    if (socket) {
      socket.disconnect();
    }
    process.exit(0);
  });
}

// Start test
main();
