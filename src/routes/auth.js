const router = require('express').Router();
const auth = require('../middleware/auth');
const supabase = require('../config/supabase');

// Auth is handled by Supabase on the frontend.
// Server-side account utilities:

// GET /api/auth/me — profile info for the signed-in user
router.get('/me', auth, async (req, res) => {
  const { data: profile } = await supabase
    .from('users')
    .select('id, email, plan, clips_this_month, created_at')
    .eq('id', req.user.id)
    .single();
  res.json({ user: { id: req.user.id, email: req.user.email }, profile: profile || null });
});

// POST /api/auth/delete-account — permanently remove the signed-in account
router.post('/delete-account', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    // 1. Remove DB rows (videos + clips cascade by user_id)
    const { data: videos } = await supabase.from('videos').select('id, user_id').eq('user_id', userId);
    if (videos && videos.length > 0) {
      const ids = videos.map((v) => v.id);
      await supabase.from('clips').delete().in('video_id', ids);
      await supabase.from('videos').delete().eq('user_id', userId);
    }
    await supabase.from('users').delete().eq('id', userId);

    // 2. Remove storage files under the user's prefixes
    const prefixes = [`clips/${userId}/`, `uploads/${userId}/`];
    for (const prefix of prefixes) {
      const { data: files } = await supabase.storage.from('snipply-videos').list(prefix, { limit: 500 });
      if (files && files.length > 0) {
        await supabase.storage.from('snipply-videos').remove(files.map((f) => `${prefix}${f.name}`));
      }
    }

    // 3. Remove the auth user (service role)
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);

    res.json({ message: 'Account deleted' });
  } catch (err) {
    console.error('[delete-account]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
