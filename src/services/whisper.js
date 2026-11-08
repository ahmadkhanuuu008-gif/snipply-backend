const Groq = require('groq-sdk');
const fs = require('fs');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function transcribeAudio(audioFilePath) {
  const transcription = await groq.audio.transcriptions.create({
    file: fs.createReadStream(audioFilePath),
    model: 'whisper-large-v3',
    response_format: 'verbose_json',
    timestamp_granularities: ['word', 'segment']
  });
  return transcription;
}

module.exports = { transcribeAudio };