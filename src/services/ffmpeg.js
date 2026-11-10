// FFmpeg wrappers: extract audio, cut+convert to 9:16, get duration
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const execAsync = promisify(exec);

const OPTS = { timeout: 10 * 60 * 1000 };

function ffmpegError(err, cmd) {
  const stderr = err.stderr ? `\nSTDERR: ${err.stderr.slice(-20000)}` : '';
  const stdout = err.stdout ? `\nSTDOUT: ${err.stdout.slice(-5000)}` : '';
  return new Error(`FFmpeg failed: ${cmd}${stderr}${stdout}`);
}

// Extract audio (16k mono WAV) from video for transcription
async function extractAudioWav(videoPath, outputPath) {
  try {
    await execAsync(
      `ffmpeg -i "${videoPath}" -vn -ar 16000 -ac 1 -c:a pcm_s16le "${outputPath}" -y`,
      OPTS
    );
  } catch (err) {
    throw ffmpegError(err, `extractAudioWav: ${videoPath} -> ${outputPath}`);
  }
  return outputPath;
}

// Cut + convert to 9:16 vertical (1080x1920) in one pass
async function makeClip(videoPath, start, end, outputPath) {
  const duration = Math.max(0.5, end - start);
  const cmdWithCodecs =
    `ffmpeg -ss ${start} -i "${videoPath}" -t ${duration} ` +
    `-vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2" ` +
    `-c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 128k -movflags +faststart "${outputPath}" -y`;
  const cmdNoCodecs =
    `ffmpeg -ss ${start} -i "${videoPath}" -t ${duration} ` +
    `-vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2" ` +
    `-movflags +faststart "${outputPath}" -y`;

  try {
    await execAsync(cmdWithCodecs, OPTS);
  } catch (err1) {
    // Fallback: let ffmpeg pick default codecs (libx264/aac may not be built in)
    try {
      await execAsync(cmdNoCodecs, OPTS);
    } catch (err2) {
      throw ffmpegError(err2, cmdNoCodecs + '\n(FIRST ATTEMPT ALSO FAILED)');
    }
  }
  if (!fs.existsSync(outputPath)) throw new Error('ffmpeg did not produce a clip');
  return outputPath;
}

// Get video duration via ffprobe
async function getVideoDuration(videoPath) {
  const { stdout } = await execAsync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
    OPTS
  );
  return parseFloat(stdout.trim());
}

module.exports = { extractAudioWav, makeClip, getVideoDuration };
