const { Worker } = require('bullmq');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { getPresignedDownloadUrl, deleteFile, uploadFile } = require('../services/storage');
const { downloadYouTubeVideo, getYouTubeTitle } = require('../services/youtube');
const { extractAudio, cutClip, convertToVertical, getVideoDuration } = require('../services/ffmpeg');
const { transcribeAudio } = require('../services/whisper');
const { findViralMoments } = require('../services/gemini');
const https = require('https');

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

    // 2. Download video
    const videoPath = path.join(tmpDir, 'original.mp4');
    if (job.data.youtubeUrl) {
      // Download from YouTube using yt-dlp
      await downloadYouTubeVideo(job.data.youtubeUrl, videoPath);
    } else {
      // Download from storage
      const downloadUrl = await getPresignedDownloadUrl(fileKey);
      await downloadFile(downloadUrl, videoPath);
    }

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

    // 7. Cut clips and upload to storage
    const createdClips = [];
    for (const moment of moments.clips) {
      const clipFileName = `clip-${uuidv4()}.mp4`;
      const clipPath = path.join(tmpDir, clipFileName);
      const verticalPath = path.join(tmpDir, `vertical-${clipFileName}`);

      await cutClip(videoPath, moment.start, moment.end, clipPath);
      await convertToVertical(clipPath, verticalPath);

      const clipKey = `clips/${userId}/${clipFileName}`;

      // Upload to storage
      await uploadFile(clipKey, fs.readFileSync(verticalPath), 'video/mp4');

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

    // 8. Increment monthly clip counter
    const { data: userData } = await supabase
      .from('users')
      .select('clips_this_month')
      .eq('id', userId)
      .single();

    await supabase
      .from('users')
      .update({ 
        clips_this_month: (userData?.clips_this_month || 0) + 1
      })
      .eq('id', userId);

    // 9. Delete original video from storage (save storage) - skip for YouTube
    if (!job.data.youtubeUrl) {
      await deleteFile(fileKey);
    }

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