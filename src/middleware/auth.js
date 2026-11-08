const supabase = require('../config/supabase');

module.exports = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    console.error('Auth error:', error?.message, 'user:', user);
    return res.status(401).json({ error: 'Invalid token', details: error?.message });
  }

  req.user = user;
  next();
};