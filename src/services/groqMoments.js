// Groq LLM fallback for finding viral moments (used if Gemini fails)
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function findViralMomentsGroq(transcript, duration) {
  const model = process.env.GROQ_MOMENTS_MODEL || 'llama-3.3-70b-versatile';
  const prompt = `
You are an expert short-form video editor. From this transcript of a ${Math.round(duration)}s video,
pick the 3-5 most engaging, viral-worthy moments (20-90 seconds each).

TRANSCRIPT (may be empty):
${(transcript || '(no transcript available)').slice(0, 12000)}

Return ONLY a JSON object like:
{"clips":[{"start":5,"end":40,"title":"Catchy title","reason":"why it works","score":88}]}

Rules:
- 0 <= start < end <= ${duration}
- each clip 20-90s long (if video is shorter, clip can be the whole video)
- score: 0-100
- max 5 clips
`;

  const completion = await groq.chat.completions.create({
    model,
    messages: [
      { role: 'user', content: prompt },
    ],
    temperature: 0.6,
    response_format: { type: 'json_object' },
  });

  const text = completion.choices?.[0]?.message?.content || '{}';
  const parsed = JSON.parse(text);
  let clips = Array.isArray(parsed.clips) ? parsed.clips : [];
  clips = clips
    .map((c) => ({
      start: Number(c.start) || 0,
      end: Number(c.end) || (Number(c.start) || 0) + 45,
      title: String(c.title || 'Catchy moment').slice(0, 120),
      reason: typeof c.reason === 'string' ? c.reason : undefined,
      score: Math.max(0, Math.min(100, Number(c.score) || 75)),
    }))
    .filter((c) => c.end > c.start)
    .map((c) => ({ ...c, start: Math.max(0, Math.min(c.start, Math.max(0, duration - 5))), end: Math.min(c.end, duration) }))
    .filter((c) => c.end > c.start);

  if (clips.length === 0) throw new Error('No clips from Groq moments');
  return { clips: clips.slice(0, 5) };
}

module.exports = { findViralMomentsGroq };
