const { Worker } = require('bullmq');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { getPresignedDownloadUrl, deleteFile, uploadFile } = require('../services/storage');
const { downloadYouTubeVideo, downloadYouTubeVideoDir } = require('../services/youtube');
const { extractAudioWav, getVideoDuration, makeClip } = require('../services/ffmpeg');
const { transcribeAudio } = require('../services/whisper');
const { findViralMoments } = require('../services/gemini');
const { findViralMomentsGroq } = require('../services/groqMoments');
const { buildAssFile, burnCaptions } = require('../services/captions');
const https = require('https');

const connection = {
  host: process.env.UPSTASH_REDIS_HOST,
  port: parseInt(process.env.UPSTASH_REDIS_PORT || '6379'),
  // ACL users require two-arg AUTH (`AUTH user pass`); absent username => single-arg (default user)
  username: process.env.UPSTASH_REDIS_USERNAME || undefined,
  password: process.env.UPSTASH_REDIS_PASSWORD,
  tls: {},
};

// ── Core pipeline (shared by BullMQ worker and inline fallback) ───────────────
async function processVideoJob(data) {
  const { videoId, userId, fileKey } = data;
  const tmpDir = path.join(require('os').tmpdir(), `snipply-${uuidv4()}`);

  try {
    fs.mkdirSync(tmpDir, { recursive: true });

    // 1. status → processing
    await supabase.from('videos').update({ status: 'processing' }).eq('id', videoId);

    // 2. Download video
    let videoPath = null;
    if (data.youtubeUrl) {
      const dir = await downloadYouTubeVideoDir(data.youtubeUrl, tmpDir);
      const f = fs.readdirSync(dir).find((x) => /^video\.\w+$/.test(x) && !x.includes('.part'));
      if (!f) throw new Error('Download finished but no video file found');
      videoPath = path.join(dir, f);
    } else {
      const downloadUrl = await getPresignedDownloadUrl(fileKey);
      videoPath = path.join(tmpDir, 'original.bin');
      await downloadFile(downloadUrl, videoPath);
    }
    console.log(`[worker] downloaded video for job ${videoId}`);

    // 3. Duration
    let duration = NaN;
    try {
      duration = await getVideoDuration(videoPath);
    } catch {}
    if (!duration || !isFinite(duration) || duration <= 0) duration = 180;
    console.log(`[worker] duration=${duration.toFixed(1)}s`);

    // 4. Extract audio + transcribe
    let transcription = null;
    let transcript = '';
    try {
      const audioPath = path.join(tmpDir, 'audio.wav');
      await extractAudioWav(videoPath, audioPath);
      transcription = await transcribeAudio(audioPath);
      transcript = transcription?.text || '';
      console.log(`[worker] transcript len=${transcript.length}`);
    } catch (err) {
      console.log(`[worker] transcription failed (will proceed without captions): ${err.message}`);
    }

    // 5. Find viral moments: Gemini → Groq LLM → evenly spaced fallback
    let moments = [];
    try {
      const res = await findViralMoments(transcript, duration);
      moments = res.clips;
      console.log(`[worker] Gemini moments: ${moments.length}`);
    } catch (err1) {
      console.log(`[worker] Gemini failed: ${err1.message.slice(0, 140)}`);
      try {
        const res = await findViralMomentsGroq(transcript, duration);
        moments = res.clips;
        console.log(`[worker] Groq moments: ${moments.length}`);
      } catch (err2) {
        console.log(`[worker] Groq moments failed: ${err2.message.slice(0, 140)} — fallback evenly spaced`);
        moments = evenlySpacedClips(duration, 45, 5).map((c, i) => ({
          ...c,
          title: `Highlight ${i + 1}`,
          score: 70,
        }));
      }
    }

    // Normalize: clamp, sort, de-overlap, cap 5, min length 5s
    moments = moments
      .map((m) => ({
        ...m,
        start: Math.max(0, Number(m.start) || 0),
        end: Math.min(duration, Number(m.end) || duration),
      }))
      .filter((m) => m.end - m.start >= 5)
      .sort((a, b) => a.start - b.start);
    const deduped = [];
    for (const m of moments) {
      const last = deduped[deduped.length - 1];
      if (last && m.start < last.end) continue; // overlapping → skip
      deduped.push(m);
    }
    moments = deduped.slice(0, 5);
    if (moments.length === 0) {
      moments = [{ start: 0, end: Math.min(duration, 45), title: 'Highlight 1', score: 70 }];
    }
    console.log(`[worker] final moments: ${moments.length}`);

    // 6. Create clips: cut → 9:16 → burn captions → upload
    const createdClips = [];
    for (let i = 0; i < moments.length; i++) {
      const moment = moments[i];
      const rawPath = path.join(tmpDir, `raw-${i}.mp4`);
      const assPath = path.join(tmpDir, `caps-${i}.ass`);
      const finalPath = path.join(tmpDir, `final-${i}.mp4`);

      if (!fs.existsSync(videoPath)) throw new Error('Input video file missing before clip cutting');
      await makeClip(videoPath, moment.start, moment.end, rawPath);

      // Burn captions when we have word/segment timing
      let captioned = false;
      if (transcription) {
        try {
          if (buildAssFile(assPath, transcription, moment.start, moment.end)) {
            await burnCaptions(rawPath, assPath, finalPath);
            captioned = fs.existsSync(finalPath) && fs.statSync(finalPath).size > 10000;
          }
        } catch (err) {
          console.log(`[worker] captions failed for clip ${i}: ${err.message.slice(0, 120)}`);
        }
      }
      if (!captioned) fs.renameSync(rawPath, finalPath);
      console.log(`[worker] clip ${i + 1}/${moments.length} ready (captions=${captioned})`);

      // Upload to Supabase Storage
      const clipFileName = `clips/${userId}/${videoId}/clip-${i + 1}-${Date.now()}.mp4`;
      await uploadFile(clipFileName, fs.readFileSync(finalPath), 'video/mp4');

      const { data: clip, error: clipErr } = await supabase
        .from('clips')
        .insert({
          video_id: videoId,
          user_id: userId,
          download_url: '',
          file_key: clipFileName,
          title: moment.title || `Clip ${i + 1}`,
          start_time: Math.round((moment.start || 0) * 10) / 10,
          end_time: Math.round((moment.end || (moment.start + 45)) * 10) / 10,
          virality_score: Math.round(Number(moment.score) || 70),
          duration: Math.round((moment.end - moment.start) * 10) / 10,
        })
        .select()
        .single();
      if (clipErr) throw new Error(`Clip DB insert failed: ${clipErr.message}`);
      createdClips.push(clip);
    }

    // 7. Bump monthly counter (+1 per processed video)
    const { data: userData } = await supabase
      .from('users')
      .select('clips_this_month')
      .eq('id', userId)
      .single();
    await supabase
      .from('users')
      .update({ clips_this_month: (userData?.clips_this_month || 0) + 1 })
      .eq('id', userId);

    // 8. Delete original upload from storage (uploaded files only)
    if (!data.youtubeUrl && fileKey) {
      try { await deleteFile(fileKey); } catch {}
    }

    // 9. Mark done
    await supabase
      .from('videos')
      .update({ status: 'completed', clips_count: createdClips.length, error: null })
      .eq('id', videoId);

    console.log(`[worker] job ${videoId} done — ${createdClips.length} clips`);
    return { success: true, clipsCreated: createdClips.length };
  } catch (err) {
    const errMsg = err.message || String(err);
    console.error(`[worker] job ${videoId} FAILED:`, errMsg);
    try {
      await supabase.from('videos').update({ status: 'failed', error: errMsg.slice(0, 1000) }).eq('id', videoId);
    } catch {}
    throw err;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// ── BullMQ worker (starts on require, same as a separate worker script) ───────
let worker = null;
if (connection.host && connection.password) {
  worker = new Worker('video-processing', async (job) => processVideoJob(job.data), {
    connection,
    concurrency: 1,
  });
  worker.on('completed', (job) => console.log(`[bullmq] job ${job.id} completed`));
  worker.on('failed', (job, err) => console.log(`[bullmq] job ${job?.id} failed: ${err.message}`));
} else {
  console.warn('[bullmq] UPSTASH_REDIS_* not set — queue worker disabled (inline fallback still works)');
}

// Helper: download a file over HTTPS (supports redirects)
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const fetchUrl = (u, redirects) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      const req = https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return fetchUrl(res.headers.location, redirects + 1);
        }
        if (res.statusCode >= 400) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      });
      req.on('error', reject);
    };
    fetchUrl(url, 0);
  });
}

// Evenly spaced fallback clips
function evenlySpacedClips(duration, length = 45, max = 5) {
  if (duration <= 60) return [{ start: 0, end: Math.min(duration, length) }];
  const usable = Math.max(0, duration - length);
  const step = Math.max(length * 0.5, usable / max);
  const clips = [];
  for (let start = 0; start < usable; start += step) {
    clips.push({
      start: Math.round(start * 10) / 10,
      end: Math.min(Math.round((start + length) * 10) / 10, Math.round(duration * 10) / 10),
    });
    if (clips.length >= max) break;
  }
  return clips;
}

module.exports = { worker, processVideoJob };
