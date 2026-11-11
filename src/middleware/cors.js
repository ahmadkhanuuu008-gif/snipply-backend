const cors = require('cors');

// FRONTEND_URL supports comma-separated origins, e.g.
// "https://snipplyhq.vercel.app,https://snipply-frontend-wivs.vercel.app"
const frontendOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

module.exports = cors({
  origin: [
    ...frontendOrigins,
    'http://localhost:5173',
    'http://localhost:3000'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
});