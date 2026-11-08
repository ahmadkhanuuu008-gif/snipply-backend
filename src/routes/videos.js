const router = require('express').Router();
const auth = require('../middleware/auth');
const usageLimit = require('../middleware/usageLimit');
const supabase = require('../config/supabase');
const { getPresignedUploadUrl, uploadFile } = require('../services/storage');
const { downloadYouTubeVideo, getYouTubeVideoId, getYouTubeTitle } = require('../services/youtube');
const { addVideoJob } = require('../services/queue');
const { v4: uuidv4 } = require('uuid');

// Get presigned URL for direct upload
router.post('/upload-url', auth, async (req, res) => {
  try {
    const { filename, contentType, fileSize } = req.body;

    // Single limit for all users: 1GB
    const maxSize = 1 * 1024 * 1024 * 1024; // 1GB for all users

    if (fileSize > maxSize) {
      return res.status(400).json({ 
        error: 'File too large. Maximum size is 1GB.' 
      });
    }

    const fileKey = `uploads/${req.user.id}/${uuidv4()}-${filename}`;
    const uploadUrl = await getPresignedUploadUrl(fileKey, contentType);

    // Create video record in DB
    const { data: video } = await supabase
      .from('videos')
      .insert({
        user_id: req.user.id,
        file_key: fileKey,
        original_name: filename,
        status: 'pending'
      })
      .select()
      .single();

    res.json({ uploadUrl, videoId: video.id, fileKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Process a YouTube URL (no auth required for now - open beta)
router.post('/youtube', usageLimit, async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'YouTube URL is required' });
    }

    // Validate YouTube URL
    const { getYouTubeVideoId, getYouTubeTitle } = require('../services/youtube');
    const videoId = getYouTubeVideoId(url);
    if (!videoId) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    const title = await getYouTubeTitle(url);

    // Use a default user ID for now (auth will be added back properly)
    const userId = '00000000-0000-0000-0000-000000000001';

    // Create video record in DB
    const { data: video, error } = await supabase
      .from('videos')
      .insert({
        user_id: userId,
        file_key: `youtube/${userId}/${videoId}`,
        original_name: title,
        status: 'pending',
        youtube_url: url
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Add to processing queue
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

    res.json({ message: 'YouTube video queued for processing', videoId: video.id });
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
      .select('id, status, created_at')
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

// Admin: manually trigger monthly reset
router.post('/admin/reset-monthly', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  const { error } = await supabase
    .from('users')
    .update({ clips_this_month: 0 })
    .neq('id', '00000000-0000-0000-0000-000000000000');
  
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Monthly clips reset for all users' });
});

module.exports = router;