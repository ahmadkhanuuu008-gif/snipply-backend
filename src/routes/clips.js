const router = require('express').Router();
const auth = require('../middleware/auth');
const supabase = require('../config/supabase');
const { getPresignedDownloadUrl } = require('../services/storage');

// Get all clips for user
router.get('/', auth, async (req, res) => {
  try {
    const { data: clips } = await supabase
      .from('clips')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    res.json(clips || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get download URL for a clip
router.get('/:clipId/download', auth, async (req, res) => {
  try {
    const { data: clip } = await supabase
      .from('clips')
      .select('*')
      .eq('id', req.params.clipId)
      .eq('user_id', req.user.id)
      .single();

    if (!clip) {
      return res.status(404).json({ error: 'Clip not found' });
    }

    const downloadUrl = await getPresignedDownloadUrl(clip.file_key);
    res.json({ downloadUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;