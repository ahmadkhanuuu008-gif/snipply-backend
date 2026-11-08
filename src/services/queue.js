const { Queue } = require('bullmq');

const connection = {
  host: process.env.UPSTASH_REDIS_HOST,
  port: process.env.UPSTASH_REDIS_PORT,
  password: process.env.UPSTASH_REDIS_PASSWORD,
  tls: {}
};

const videoQueue = new Queue('video-processing', { connection });

async function addVideoJob(data) {
  return videoQueue.add('process-video', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 }
  });
}

module.exports = { videoQueue, addVideoJob };