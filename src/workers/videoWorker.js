const { Worker } = require('bullmq');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { getPresignedDownloadUrl, deleteFile } = require('../services/r2');
const { extractAudio, cutClip, convertToVertical, getVideoDuration } = require('../services/ffmpeg');
const { transcribeAudio } = require('../services/whisper');
const { findViralMoments } = require('../services/gemini');
const https = require('https');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

const connection = {
  host: process.env.UPSTASH_REDIS_HOST,
  port: parseInt(process.env.UPSTASH_REDIS_PORT),
  password: process.env.UPSTASH_REDIS_PASSWORD,
  tls: {}
};

const worker = new Worker('video-processing', async (job) => {
  const { videoId, userId, fileKey } = job.data;
  const tmpDir = `/tmp/${uuidv4()}`;

  try {
    fs.mkdirSync(tmpDir, { recursive: true });

    // 1. Update status to processing
    await supabase.from('videos').update({ status: 'processing' }).eq('id', videoId);

    // 2. Download video from R2 to tmp
    const downloadUrl = await getPresignedDownloadUrl(fileKey);
    const videoPath = path.join(tmpDir, 'original.mp4');
    await downloadFile(downloadUrl, videoPath);

    // 3. Get video duration
    const duration = await getVideoDuration(videoPath);

    // 4. Extract audio
    const audioPath = path.join(tmpDir, 'audio.mp3');
    await extractAudio(videoPath, audioPath);

    // 5. Transcribe with Groq Whisper
    const transcription = await transcribeAudio(audioPath);
    const transcript = transcription.text;

    // 6. Find viral moments with Gemini
    let moments;
    try {
      moments = await findViralMoments(transcript, duration);
    } catch (err) {
      // Fallback: split video into equal parts
      moments = { clips: generateFallbackClips(duration) };
    }

    // 7. Cut clips and upload to R2
    const createdClips = [];
    for (const moment of moments.clips) {
      const clipFileName = `clip-${uuidv4()}.mp4`;
      const clipPath = path.join(tmpDir, clipFileName);
      const verticalPath = path.join(tmpDir, `vertical-${clipFileName}`);

      await cutClip(videoPath, moment.start, moment.end, clipPath);
      await convertToVertical(clipPath, verticalPath);

      const clipKey = `clips/${userId}/${clipFileName}`;

      // Upload to R2
      await r2.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: clipKey,
        Body: fs.readFileSync(verticalPath),
        ContentType: 'video/mp4'
      }));

      // Save clip to database
      const { data: clip } = await supabase.from('clips').insert({
        video_id: videoId,
        user_id: userId,
        file_key: clipKey,
        title: moment.title,
        start_time: moment.start,
        end_time: moment.end,
        virality_score: moment.score || 0,
        duration: moment.end - moment.start
      }).select().single();

      createdClips.push(clip);
    }

    // 8. Deduct credits (5 per video)
    const { data: userData } = await supabase
      .from('users').select('credits_used').eq('id', userId).single();

    await supabase.from('users')
      .update({ credits_used: (userData.credits_used || 0) + 5 })
      .eq('id', userId);

    // 9. Delete original video from R2 (save storage)
    await deleteFile(fileKey);

    // 10. Mark video as done
    await supabase.from('videos')
      .update({ status: 'completed', clips_count: createdClips.length })
      .eq('id', videoId);

    return { success: true, clipsCreated: createdClips.length };

  } catch (err) {
    await supabase.from('videos')
      .update({ status: 'failed', error: err.message })
      .eq('id', videoId);
    throw err;
  } finally {
    // Always clean up tmp files
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}, { connection, concurrency: 2 });

// Helper: download file from URL to local path
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', reject);
  });
}

// Fallback: generate clips if AI fails
function generateFallbackClips(duration) {
  const clips = [];
  const clipLength = 60;
  const count = Math.min(3, Math.floor(duration / clipLength));
  for (let i = 0; i < count; i++) {
    clips.push({
      start: i * (duration / count),
      end: i * (duration / count) + clipLength,
      title: `Clip ${i + 1}`,
      score: 70
    });
  }
  return clips;
}

worker.on('completed', job => console.log(`Job ${job.id} completed`));
worker.on('failed', (job, err) => console.log(`Job ${job?.id} failed: ${err.message}`));

module.exports = worker;