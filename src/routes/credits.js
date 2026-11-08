const router = require('express').Router();
const auth = require('../middleware/auth');
const supabase = require('../config/supabase');

// Get user credits
router.get('/', auth, async (req, res) => {
  try {
    const { data } = await supabase
      .from('users')
      .select('credits_used, credits_limit, plan')
      .eq('id', req.user.id)
      .single();

    res.json({
      used: data.credits_used,
      limit: data.credits_limit,
      remaining: data.credits_limit - data.credits_used,
      plan: data.plan
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;