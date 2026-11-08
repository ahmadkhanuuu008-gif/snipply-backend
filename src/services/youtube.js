const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs');
const path = require('path');

// Download a YouTube video using yt-dlp
async function downloadYouTubeVideo(url, outputPath) {
  await execAsync(
    `yt-dlp -f "best[ext=mp4]/best" -o "${outputPath}" "${url}" --no-playlist`
  );
  return outputPath;
}

// Extract video ID from YouTube URL
function getYouTubeVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Get video title from YouTube
async function getYouTubeTitle(url) {
  try {
    const { stdout } = await execAsync(
      `yt-dlp --get-title "${url}" --no-playlist`
    );
    return stdout.trim();
  } catch (err) {
    return 'YouTube Video';
  }
}

module.exports = { downloadYouTubeVideo, getYouTubeVideoId, getYouTubeTitle };