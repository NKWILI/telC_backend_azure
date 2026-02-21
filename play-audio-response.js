/**
 * Audio Playback Test for Gemini Responses
 * Decodes Base64 audio and saves it as a WAV file you can play
 * 
 * Usage: 
 *   1. Run the complete test and get audio response
 *   2. Copy the Base64 audio data
 *   3. node play-audio-response.js <base64-audio-data>
 */

const fs = require('fs');

// WAV file header for PCM audio
function createWavHeader(dataLength, sampleRate = 16000, channels = 1, bitsPerSample = 16) {
  const buffer = Buffer.alloc(44);
  
  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  
  // fmt subchunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk size
  buffer.writeUInt16LE(1, 20); // Audio format (1 = PCM)
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28); // Byte rate
  buffer.writeUInt16LE(channels * bitsPerSample / 8, 32); // Block align
  buffer.writeUInt16LE(bitsPerSample, 34);
  
  // data subchunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);
  
  return buffer;
}

function saveAudioToWav(base64Audio, outputFile = 'gemini-response.wav') {
  try {
    // Decode Base64 to Buffer
    const audioBuffer = Buffer.from(base64Audio, 'base64');
    
    console.log(`\n📊 Audio Information:`);
    console.log(`   Raw audio size: ${audioBuffer.length} bytes`);
    console.log(`   Duration: ~${(audioBuffer.length / (16000 * 2)).toFixed(2)}s (at 16kHz)`);
    
    // Create WAV header
    const wavHeader = createWavHeader(audioBuffer.length, 16000, 1, 16);
    
    // Combine header + audio data
    const wavFile = Buffer.concat([wavHeader, audioBuffer]);
    
    // Save to file
    fs.writeFileSync(outputFile, wavFile);
    
    console.log(`\n✅ Audio saved successfully!`);
    console.log(`   File: ${outputFile}`);
    console.log(`   Size: ${(wavFile.length / 1024).toFixed(2)} KB`);
    console.log(`\n🎵 To play the audio:`);
    console.log(`   - Windows: Double-click ${outputFile}`);
    console.log(`   - macOS: open ${outputFile}`);
    console.log(`   - Linux: aplay ${outputFile}`);
    console.log(`   - VLC: vlc ${outputFile}`);
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    console.log(`\nUsage: node play-audio-response.js <base64-audio-data>`);
  }
}

// Main execution
const base64Audio = process.argv[2];

if (!base64Audio) {
  console.log(`
🎵 Gemini Audio Response Player
================================

This script converts Base64 audio from Gemini into a playable WAV file.

Usage:
  node play-audio-response.js <base64-audio-data>

Example:
  node play-audio-response.js "SGVsbG8gd29ybGQ..."

To get audio data:
  1. Run: node test-complete-flow.js
  2. Look for "Audio received" in the output
  3. Copy the Base64 data from the response
  4. Run this script with that data

The script will create a "gemini-response.wav" file you can play!
  `);
  process.exit(1);
}

saveAudioToWav(base64Audio);
