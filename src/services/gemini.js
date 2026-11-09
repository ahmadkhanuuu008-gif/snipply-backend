const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function findViralMoments(transcript, duration) {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const prompt = `
You are an expert video editor. Analyze this transcript and find 
the 3-5 most engaging, viral-worthy moments for short-form content.

Transcript: ${transcript}
Video duration: ${duration} seconds

Return ONLY valid JSON with this exact structure, no other text:
{
  "clips": [
    {
      "start": 10.5,
      "end": 45.2,
      "title": "Short catchy title",
      "reason": "Why this moment is viral",
      "score": 87
    }
  ]
}

Rules:
- start and end must be valid numbers within 0 and ${duration}
- end must always be greater than start
- each clip must be between 20 and 90 seconds long
- score is 0-100 representing viral potential
- return maximum 5 clips
`;

  const result = await model.generateContent(prompt);
  const raw = result.response.text();
  // Strip markdown code fences if present
  const text = raw.replace(/```(?:json)?/gi, '').trim();

  // Validate and parse JSON
  const match = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(match ? match[0] : text);

  // Validate timestamps
  const validClips = parsed.clips.filter(clip => 
    typeof clip.start === 'number' &&
    typeof clip.end === 'number' &&
    clip.start >= 0 &&
    clip.end <= duration &&
    clip.end > clip.start &&
    (clip.end - clip.start) >= 20 &&
    (clip.end - clip.start) <= 90
  );

  if (validClips.length === 0) {
    throw new Error('No valid clips found in AI response');
  }

  return { clips: validClips };
}

module.exports = { findViralMoments };