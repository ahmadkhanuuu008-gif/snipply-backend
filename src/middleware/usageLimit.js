const supabase = require('../config/supabase');

module.exports = async (req, res, next) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('clips_this_month, last_reset')
      .eq('id', req.user.id)
      .single();

    if (error || !user) return next();

    // Check if we need to reset (new month)
    const now = new Date();
    const lastReset = user.last_reset 
      ? new Date(user.last_reset) 
      : null;
    
    const needsReset = !lastReset || 
      lastReset.getMonth() !== now.getMonth() || 
      lastReset.getFullYear() !== now.getFullYear();

    if (needsReset) {
      await supabase
        .from('users')
        .update({ 
          clips_this_month: 0, 
          last_reset: now.toISOString() 
        })
        .eq('id', req.user.id);
      return next();
    }

    if ((user.clips_this_month || 0) >= 10) {
      return res.status(429).json({
        error: 'Monthly limit reached',
        message: 'You have used your 10 free clips this month. Resets on the 1st. Snipply is free forever — come back next month!',
        resets_on: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()
      });
    }

    next();
  } catch (err) {
    next();
  }
};