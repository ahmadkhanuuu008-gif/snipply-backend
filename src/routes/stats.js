const router = require('express').Router();
const auth = require('../middleware/auth');
const supabase = require('../config/supabase');

router.get('/', auth, async (req, res) => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('clips_this_month, last_reset')
      .eq('id', req.user.id)
      .single();

    const clipsUsed = user?.clips_this_month || 0;
    const clipsLimit = 10;
    const clipsRemaining = Math.max(0, clipsLimit - clipsUsed);

    const now = new Date();
    const resetsOn = new Date(
      now.getFullYear(), 
      now.getMonth() + 1, 
      1
    ).toISOString();

    res.json({
      clips_used: clipsUsed,
      clips_limit: clipsLimit,
      clips_remaining: clipsRemaining,
      resets_on: resetsOn,
      plan: 'free',
      is_free_forever: true
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;