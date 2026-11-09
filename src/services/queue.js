const { Queue } = require('bullmq');

const connection = {
  host: process.env.UPSTASH_REDIS_HOST,
  port: process.env.UPSTASH_REDIS_PORT,
  password: process.env.UPSTASH_REDIS_PASSWORD,
  tls: {}
};

let videoQueue = null;
try {
  if (connection.host && connection.password) {
    videoQueue = new Queue('video-processing', { connection });
  }
} catch (err) {
  console.error('Queue init failed:', err.message);
}

async function addVideoJob(data) {
  if (videoQueue) {
    try {
      return await videoQueue.add('process-video', data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: 50,
        removeOnFail: 50
      });
    } catch (err) {
      console.error('[queue] BullMQ add failed, falling back to inline processing:', err.message);
    }
  }
  // Fallback: process directly in-process (free tier safety net)
  const { processVideoJob } = require('../workers/videoWorker');
  processVideoJob(data).catch((err) => console.error('[inline] job failed:', err.message));
  return null;
}

module.exports = { videoQueue, addVideoJob };
