const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs');
const path = require('path');

// yt-dlp download, capped at 720p for speed; retries with different player clients
async function downloadYouTubeVideoDir(url, targetDir) {
  const base = [
    '-f', 'bv*[ext=mp4][vcodec^=avc1][height<=720]+ba[ext=m4a]/b[height<=720]/b',
    '--no-playlist', '--no-warnings', '-N', '4',
    '--merge-output-format', 'mp4',
    '--socket-timeout', '20',
    '-o', path.join(targetDir, 'video.%(ext)s'),
  ];

  const attempts = [
    base, // default client
    [...base, '--extractor-args', 'youtube:player_client=web_safari'],
    [...base, '--extractor-args', 'youtube:player_client=mweb'],
  ];

  let lastErr = null;
  for (const args of attempts) {
    try {
      const { stderr } = await execAsync(`yt-dlp ${args.map(quote).join(' ')} ${quote(url)}`, {
        timeout: 12 * 60 * 1000,
        maxBuffer: 32 * 1024 * 1024,
      });
      // yt-dlp logs "Downloading" etc. on stderr; errors surface as non-zero exit code
      lastErr = stderr ? stderr.slice(-400) : null;
      const found = fs.readdirSync(targetDir).filter((f) => /^video\.\w+$/.test(f) && !f.includes('.part'));
      if (found.length > 0) return targetDir;
    } catch (err) {
      lastErr = err.stderr ? String(err.stderr).slice(-400) : err.message;
      console.log(`[yt-dlp] attempt failed: ${lastErr}`);
    }
  }
  throw new Error(`YouTube download failed: ${lastErr || 'unknown error'}`);
}

function quote(s) {
  if (typeof s !== 'string') return String(s);
  return `"${s.replace(/(["$`\\])/g, '\\$1')}"`;
}

// Extract video ID
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

// Get video title (best effort)
async function getYouTubeTitle(url) {
  try {
    const { stdout } = await execAsync(
      `yt-dlp --no-playlist --skip-download --no-warnings --print title ${quote(url)}`,
      { timeout: 45 * 1000, maxBuffer: 8 * 1024 * 1024 }
    );
    return (stdout.split('\n')[0] || '').trim() || 'YouTube Video';
  } catch {
    return 'YouTube Video';
  }
}

// Download video to a specific file path (legacy helper)
async function downloadYouTubeVideo(url, outputPath) {
  const dir = await downloadYouTubeVideoDir(url, path.dirname(outputPath));
  const f = fs.readdirSync(dir).find((x) => /^video\.\w+$/.test(x));
  if (!f) throw new Error('No video file found after download');
  return path.join(dir, f);
}

module.exports = { downloadYouTubeVideo, downloadYouTubeVideoDir, getYouTubeVideoId, getYouTubeTitle };
