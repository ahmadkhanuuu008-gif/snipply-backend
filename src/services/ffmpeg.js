const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const execAsync = promisify(exec);

const OPTS = { timeout: 10 * 60 * 1000 };

// Extract audio (16k mono WAV) from video for transcription
async function extractAudioWav(videoPath, outputPath) {
  await execAsync(
    `ffmpeg -i "${videoPath}" -vn -ar 16000 -ac 1 -c:a pcm_s16le "${outputPath}" -y`,
    OPTS
  );
  return outputPath;
}

// Cut + convert to 9:16 vertical (1080x1920) in one pass
async function makeClip(videoPath, start, end, outputPath) {
  const duration = Math.max(0.5, end - start);
  await execAsync(
    `ffmpeg -ss ${start} -i "${videoPath}" -t ${duration} ` +
      `-vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2" ` +
      `-c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 128k -movflags +faststart "${outputPath}" -y`,
    OPTS
  );
  if (!fs.existsSync(outputPath)) throw new Error('ffmpeg did not produce a clip');
  return outputPath;
}

// Get video duration via ffprobe
async function getVideoDuration(videoPath) {
  const { stdout } = await execAsync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
  );
  return parseFloat(stdout.trim());
}

module.exports = { extractAudioWav, makeClip, getVideoDuration };
