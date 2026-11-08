const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Extract audio from video for transcription
async function extractAudio(videoPath, outputPath) {
  await execAsync(
    `ffmpeg -i "${videoPath}" -vn -acodec mp3 -ar 16000 -ac 1 "${outputPath}" -y`
  );
  return outputPath;
}

// Cut video clip at timestamps
async function cutClip(videoPath, start, end, outputPath) {
  const duration = end - start;
  await execAsync(
    `ffmpeg -i "${videoPath}" -ss ${start} -t ${duration} -c:v libx264 -c:a aac -strict experimental "${outputPath}" -y`
  );
  return outputPath;
}

// Convert to vertical 9:16 format for shorts
async function convertToVertical(inputPath, outputPath) {
  await execAsync(
    `ffmpeg -i "${inputPath}" -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2" -c:a copy "${outputPath}" -y`
  );
  return outputPath;
}

// Get video duration
async function getVideoDuration(videoPath) {
  const { stdout } = await execAsync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
  );
  return parseFloat(stdout.trim());
}

module.exports = { extractAudio, cutClip, convertToVertical, getVideoDuration };