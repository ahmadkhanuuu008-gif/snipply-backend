const rateLimit = require('express-rate-limit');

module.exports = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 600, // generous: includes live status polling from the dashboard
  message: { error: 'Too many requests, slow down.' },
  standardHeaders: true,
  legacyHeaders: false
});