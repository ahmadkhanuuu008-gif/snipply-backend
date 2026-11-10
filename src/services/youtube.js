const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ── Strategy 1: yt-dlp with cookies + multiple player clients ────────────────
async function tryYtDlp(url, targetDir) {
  const base = [
    '-f', 'bv*[ext=mp4][vcodec^=avc1][height<=720]+ba[ext=m4a]/b[height<=720]/b',
    '--no-playlist', '--no-warnings', '-N', '4',
    '--merge-output-format', 'mp4',
    '--socket-timeout', '20',
    '-o', path.join(targetDir, 'video.%(ext)s'),
    '--add-header', 'Cookie: APISID=NsR7xL44BseZXT_O/A-EPV4ynk73-D68Vq; SAPISID=xSkKj7nJNBM40jip/AfmfnhW1beE8fsnJs; __Secure-1PAPISID=xSkKj7nJNBM40jip/AfmfnhW1beE8fsnJs; __Secure-3PAPISID=xSkKj7nJNBM40jip/AfmfnhW1beE8fsnJs; SID=g.a000EgmhVx62dJrs8WXAiV4LwJ93SLLj3iDAaZq71C5MW_A9FaQxjrhsxoKlsWJsOJQ-xN8eQAACgYKAXoSARISFQHGX2Mis72gGeHhHPVdmWUg-D78ZBoVAUF8yKoBZD_wxfhI1l6gABkiGpw20076; PREF=f4=4000000&f6=40000000; SIDCC=APD_SKEyL-qXcsqRUJuycpMbp2JNSE01AonwtrqfhukFFR2auF_dm9PiSTEGViLj-P12dKzK4w',
    '--add-header', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    '--add-header', 'Accept-Language: en-US,en;q=0.9',
    '--force-ipv4',
  ];

  const attempts = [
    base,
    [...base, '--extractor-args', 'youtube:player_client=web_safari'],
    [...base, '--extractor-args', 'youtube:player_client=mweb'],
    [...base, '--extractor-args', 'youtube:player_client=tv'],
    [...base, '--extractor-args', 'youtube:player_client=android'],
    [...base, '--extractor-args', 'youtube:player_client=ios'],
  ];

  let lastErr = null;
  for (const args of attempts) {
    try {
      const { stderr } = await execAsync(`yt-dlp ${args.map(quote).join(' ')} ${quote(url)}`, {
        timeout: 12 * 60 * 1000,
        maxBuffer: 32 * 1024 * 1024,
      });
      lastErr = stderr ? stderr.slice(-400) : null;
      const found = fs.readdirSync(targetDir).filter((f) => /^video\.\w+$/.test(f) && !f.includes('.part'));
      if (found.length > 0) return targetDir;
    } catch (err) {
      lastErr = err.stderr ? String(err.stderr).slice(-400) : err.message;
      console.log(`[yt-dlp] attempt failed: ${lastErr.slice(0, 120)}`);
    }
  }
  throw new Error(`yt-dlp failed: ${lastErr || 'unknown error'}`);
}

// ── Strategy 2: Invidious API fallback ───────────────────────────────────────
const invidiousInstances = [
  'https://invidious.snopyta.org',
  'https://invidious.kavin.rocks',
  'https://vid.puffyan.us',
  'https://invidious.namazso.eu',
  'https://yt.artemislena.eu',
];

async function tryInvidious(url, targetDir) {
  const videoId = getYouTubeVideoId(url);
  if (!videoId) throw new Error('Could not extract video ID');

  for (const instance of invidiousInstances) {
    try {
      // Get video info
      const info = await fetchJson(`${instance}/api/v1/videos/${videoId}`);
      if (!info) continue;

      // Find a video stream URL (prefer mp4, 720p or lower)
      let streamUrl = null;
      if (info.formatStreams) {
        const mp4Streams = info.formatStreams.filter((s) => s.container === 'mp4' || s.type?.includes('mp4'));
        if (mp4Streams.length > 0) {
          streamUrl = mp4Streams.sort((a, b) => (b.quality || 0) - (a.quality || 0))[0]?.url;
        }
      }
      if (!streamUrl && info.adaptiveFormats) {
        const videoFormats = info.adaptiveFormats.filter((f) => f.type?.startsWith('video/'));
        if (videoFormats.length > 0) {
          streamUrl = videoFormats.sort((a, b) => (b.quality || 0) - (a.quality || 0))[0]?.url;
        }
      }

      if (!streamUrl) continue;

      // Download the video
      const outputPath = path.join(targetDir, 'video.mp4');
      await downloadFile(streamUrl, outputPath);
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 100000) {
        return targetDir;
      }
    } catch (err) {
      console.log(`[invidious] ${instance} failed: ${err.message.slice(0, 120)}`);
    }
  }
  throw new Error('All Invidious instances failed');
}

// ── Strategy 3: Cobalt.tools API fallback ────────────────────────────────────
async function tryCobalt(url, targetDir) {
  const videoId = getYouTubeVideoId(url);
  if (!videoId) throw new Error('Could not extract video ID');

  const response = await fetch('https://api.cobalt.tools/api/json', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      url: `https://youtube.com/watch?v=${videoId}`,
      vQuality: '720',
      isAudioOnly: false,
      disableMetadata: true,
    }),
  });

  if (!response.ok) throw new Error(`Cobalt API returned ${response.status}`);

  const data = await response.json();
  if (data.status !== 'stream' && data.status !== 'redirect') {
    throw new Error(`Cobalt returned status: ${data.status} - ${data.text || 'unknown'}`);
  }

  const streamUrl = data.url;
  if (!streamUrl) throw new Error('Cobalt did not return a download URL');

  const outputPath = path.join(targetDir, 'video.mp4');
  await downloadFile(streamUrl, outputPath);
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 100000) {
    return targetDir;
  }
  throw new Error('Cobalt download produced empty file');
}

// ── Main download function with fallback chain ───────────────────────────────
async function downloadYouTubeVideoDir(url, targetDir) {
  const errors = [];

  // Strategy 1: yt-dlp
  try {
    await tryYtDlp(url, targetDir);
    const found = fs.readdirSync(targetDir).filter((f) => /^video\.\w+$/.test(f) && !f.includes('.part'));
    if (found.length > 0) return targetDir;
  } catch (e) {
    errors.push(`yt-dlp: ${e.message}`);
    console.log(`[youtube] yt-dlp failed: ${e.message.slice(0, 200)}`);
  }

  // Strategy 2: Invidious
  try {
    await tryInvidious(url, targetDir);
    const found = fs.readdirSync(targetDir).filter((f) => /^video\.\w+$/.test(f) && !f.includes('.part'));
    if (found.length > 0) return targetDir;
  } catch (e) {
    errors.push(`invidious: ${e.message}`);
    console.log(`[youtube] invidious failed: ${e.message.slice(0, 200)}`);
  }

  // Strategy 3: Cobalt
  try {
    await tryCobalt(url, targetDir);
    const found = fs.readdirSync(targetDir).filter((f) => /^video\.\w+$/.test(f) && !f.includes('.part'));
    if (found.length > 0) return targetDir;
  } catch (e) {
    errors.push(`cobalt: ${e.message}`);
    console.log(`[youtube] cobalt failed: ${e.message.slice(0, 200)}`);
  }

  throw new Error(`YouTube download failed (all strategies exhausted): ${errors.join(' | ')}`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
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

function getYouTubeTitle(url) {
  try {
    const { stdout } = execAsync(
      `yt-dlp --no-playlist --skip-download --no-warnings --print title ${quote(url)}`,
      { timeout: 45 * 1000, maxBuffer: 8 * 1024 * 1024 }
    );
    return (stdout.split('\n')[0] || '').trim() || 'YouTube Video';
  } catch {
    return 'YouTube Video';
  }
}

async function downloadYouTubeVideo(url, outputPath) {
  const dir = await downloadYouTubeVideoDir(url, path.dirname(outputPath));
  const f = fs.readdirSync(dir).find((x) => /^video\.\w+$/.test(x));
  if (!f) throw new Error('No video file found after download');
  return path.join(dir, f);
}

// HTTP helpers
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode >= 400) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    const req = mod.get(url, { timeout: 120000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode >= 400) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    });
    req.on('error', (err) => { file.close(); try { fs.unlinkSync(dest); } catch {} reject(err); });
    req.on('timeout', () => { req.destroy(); file.close(); try { fs.unlinkSync(dest); } catch {} reject(new Error('download timeout')); });
  });
}

function quote(s) {
  if (typeof s !== 'string') return String(s);
  return `"${s.replace(/(["$`\\])/g, '\\$1')}"`;
}

module.exports = { downloadYouTubeVideo, downloadYouTubeVideoDir, getYouTubeVideoId, getYouTubeTitle };
