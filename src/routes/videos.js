const router = require('express').Router();
const auth = require('../middleware/auth');
const usageLimit = require('../middleware/usageLimit');
const supabase = require('../config/supabase');
const { getPresignedUploadUrl, getSignedUrl, uploadFile } = require('../services/storage');
const { getYouTubeVideoId, getYouTubeTitle } = require('../services/youtube');
const { addVideoJob } = require('../services/queue');
const { v4: uuidv4 } = require('uuid');

// GET /api/videos — list user's videos
router.get('/', auth, async (req, res) => {
  try {
    const { data: videos } = await supabase
      .from('videos')
      .select('id, original_name, status, clips_count, error, youtube_url, file_key, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(25);
    res.json(videos || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/videos/usage — monthly usage for banner
router.get('/usage', auth, async (req, res) => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('clips_this_month, last_reset')
      .eq('id', req.user.id)
      .single();
    res.json({
      used: user?.clips_this_month || 0,
      limit: 10,
      resets_on: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString(),
      plan: 'free'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET presigned URL for direct upload
router.post('/upload-url', auth, async (req, res) => {
  try {
    const { filename, contentType, fileSize } = req.body;

    // Free tier upload cap: 400MB (processing runs on free infrastructure)
    const maxSize = 400 * 1024 * 1024;
    if (fileSize > maxSize) {
      return res.status(400).json({
        error: 'File too large. Free uploads up to 400MB — use a YouTube link for longer videos.'
      });
    }

    const fileKey = `uploads/${req.user.id}/${uuidv4()}-${(filename || 'video.mp4').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const uploadUrl = await getPresignedUploadUrl(fileKey, contentType || 'video/mp4');

    // Create video record in DB
    const { data: video, error: insertErr } = await supabase
      .from('videos')
      .insert({
        user_id: req.user.id,
        file_key: fileKey,
        original_name: filename || 'Uploaded video',
        status: 'pending'
      })
      .select()
      .single();

    if (insertErr) return res.status(500).json({ error: insertErr.message });

    res.json({ uploadUrl, videoId: video.id, fileKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Process a YouTube URL (auth + 10/month usage limit)
router.post('/youtube', auth, usageLimit, async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'YouTube URL is required' });
    }

    const videoId = getYouTubeVideoId(url);
    if (!videoId) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    const userId = req.user.id;
    const title = await getYouTubeTitle(url);

    // Create video record in DB
    const { data: video, error } = await supabase
      .from('videos')
      .insert({
        user_id: userId,
        file_key: `youtube/${userId}/${videoId}`,
        original_name: title,
        status: 'pending',
        youtube_url: url,
        youtube_id: videoId,
        source: 'youtube',
        original_url: url
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Queue processing (falls back to inline processing if Redis is down)
    await addVideoJob({
      videoId: video.id,
      userId: userId,
      fileKey: video.file_key,
      youtubeUrl: url
    });

    // Update video status
    await supabase
      .from('videos')
      .update({ status: 'queued' })
      .eq('id', video.id);

    res.json({
      message: 'Video queued for processing! Clips usually take 2-5 minutes.',
      videoId: video.id,
      title
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start processing after upload complete
router.post('/:videoId/process', auth, usageLimit, async (req, res) => {
  try {
    const { videoId } = req.params;

    // Verify video belongs to user
    const { data: video } = await supabase
      .from('videos')
      .select('*')
      .eq('id', videoId)
      .eq('user_id', req.user.id)
      .single();

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Add to processing queue
    await addVideoJob({
      videoId: video.id,
      userId: req.user.id,
      fileKey: video.file_key
    });

    // Update video status
    await supabase
      .from('videos')
      .update({ status: 'queued' })
      .eq('id', videoId);

    res.json({ message: 'Video queued for processing', videoId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get video status
router.get('/:videoId/status', auth, async (req, res) => {
  try {
    const { data: video } = await supabase
      .from('videos')
      .select('id, status, error, clips_count, created_at')
      .eq('id', req.params.videoId)
      .eq('user_id', req.user.id)
      .single();

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    res.json(video);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET clips for a video (with signed playback/download URLs)
router.get('/:videoId/clips', auth, async (req, res) => {
  try {
    const { data: video } = await supabase
      .from('videos')
      .select('id, user_id')
      .eq('id', req.params.videoId)
      .eq('user_id', req.user.id)
      .single();

    if (!video) return res.status(404).json({ error: 'Video not found' });

    const { data: clips } = await supabase
      .from('clips')
      .select('id, title, file_key, start_time, end_time, virality_score, duration, created_at')
      .eq('video_id', req.params.videoId)
      .eq('user_id', req.user.id)
      .order('start_time', { ascending: true });

    const withUrls = [];
    for (const clip of clips || []) {
      try {
        const url = await getSignedUrl(clip.file_key, 6 * 24 * 3600);
        withUrls.push({ ...clip, url });
      } catch {
        withUrls.push({ ...clip, url: null });
      }
    }
    res.json(withUrls);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: manually trigger monthly reset
router.post('/admin/reset-monthly', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { error } = await supabase
    .from('users')
    .update({ clips_this_month: 0, last_reset: new Date().toISOString() })
    .neq('id', '00000000-0000-0000-0000-000000000000');

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Monthly clips reset for all users' });
});

module.exports = router;
