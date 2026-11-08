const express = require('express');
const app = express();
require('dotenv').config();

const corsMiddleware = require('./middleware/cors');
const rateLimitMiddleware = require('./middleware/rateLimit');

app.use(corsMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(rateLimitMiddleware);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/videos', require('./routes/videos'));
app.use('/api/clips', require('./routes/clips'));
app.use('/api/stats', require('./routes/stats'));

// Health check (root + /health for Railway/Render default healthchecks)
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'snipply-backend' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'snipply-backend' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Snipply backend running on port ${PORT}`);
});

module.exports = app;