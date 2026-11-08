const router = require('express').Router();
const auth = require('../middleware/auth');
const supabase = require('../config/supabase');
const { getPresignedUploadUrl } = require('../services/r2');
const { addVideoJob } = require('../services/queue');
const { v4: uuidv4 } = require('uuid');

// Get presigned URL for direct R2 upload
router.post('/upload-url', auth, async (req, res) => {
  try {
    const { filename, contentType, fileSize } = req.body;

    // Check file size limits
    const { data: userData } = await supabase
      .from('users')
      .select('plan')
      .eq('id', req.user.id)
      .single();

    const maxSize = userData?.plan === 'pro' 
      ? 2 * 1024 * 1024 * 1024  // 2GB for pro
      : 500 * 1024 * 1024;       // 500MB for free

    if (fileSize > maxSize) {
      return res.status(400).json({ 
        error: 'File too large for your plan' 
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

// Start processing after upload complete
router.post('/:videoId/process', auth, async (req, res) => {
  try {
    const { videoId } = req.params;

    // Check user has enough credits
    const { data: userData } = await supabase
      .from('users')
      .select('credits_used, credits_limit, plan')
      .eq('id', req.user.id)
      .single();

    const creditCost = 5; // 5 credits per video
    if (userData.credits_used + creditCost > userData.credits_limit) {
      return res.status(400).json({ 
        error: 'Not enough credits' 
      });
    }

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

module.exports = router;