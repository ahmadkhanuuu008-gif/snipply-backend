const router = require('express').Router();

// Auth is handled by Supabase on the frontend.
// This route is kept for future server-side auth utilities.
router.get('/me', (req, res) => {
  res.json({ message: 'Auth handled by Supabase' });
});

module.exports = router;