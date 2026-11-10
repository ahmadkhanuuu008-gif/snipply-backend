// ASS caption generation + burning via ffmpeg/libass
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs');

// Group whisper words into readable caption lines (max ~4 words / 18 chars)
function groupWords(words, maxWords = 4, maxChars = 18) {
  const lines = [];
  let cur = [];
  let chars = 0;
  for (const w of words) {
    const word = (w.word || '').trim();
    if (!word) continue;
    if (cur.length >= maxWords || chars + word.length + 1 > maxChars) {
      lines.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push({ word, start: w.start, end: w.end });
    chars += word.length + 1;
  }
  if (cur.length) lines.push(cur);
  return lines;
}

// Build an .ass subtitle file covering only [start, end] (clip-local timing)
function buildAssFile(destPath, whisperData, start, end) {
  const words = Array.isArray(whisperData?.words) ? whisperData.words : [];
  const segments = Array.isArray(whisperData?.segments) ? whisperData.segments : [];

  let events = [];
  if (words.length > 0) {
    const inRange = words.filter((w) => (w.end ?? 0) > start && (w.start ?? 0) < end);
    const lines = groupWords(inRange);
    events = lines.map((line) => ({
      start: Math.max(0, line[0].start - start),
      end: Math.min(end - start, line[line.length - 1].end - start),
      text: line.map((l) => l.word).join(' '),
    }));
  } else if (segments.length > 0) {
    // Fallback to segment-level captions, split long segments into 2 lines
    events = segments
      .filter((s) => (s.end ?? 0) > start && (s.start ?? 0) < end)
      .map((s) => {
        let t = (s.text || '').trim();
        let t2 = '';
        if (t.length > 40) {
          const mid = Math.floor(t.length / 2);
          const space = t.lastIndexOf(' ', mid);
          const cut = space > mid * 0.4 ? space : t.indexOf(' ', mid) === -1 ? mid : t.indexOf(' ', mid);
          t2 = t.slice(cut).trim();
          t = t.slice(0, cut).trim();
        }
        return { text: t, text2: t2, s: Math.max(0, s.start - start), e: Math.min(end - start, s.end - start) };
      })
      .flatMap((s) => {
        const dur = Math.max(0.3, (s.e - s.s) / (s.text2 ? 2 : 1));
        const out = [{ start: s.s, end: s.s + dur, text: s.text }];
        if (s.text2) out.push({ start: s.s + dur, end: s.e, text: s.text2 });
        return out;
      });
  }

  // Drop empty / zero-duration events
  events = events.filter((e) => e.text && e.end > e.start && e.end - e.start >= 0.08);

  if (events.length === 0) return null;

  const fmt = (sec) => {
    const s = Math.max(0, sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec2 = Math.floor(s % 60);
    const cs = Math.floor((s % 1) * 100);
    return `${h}:${String(m).padStart(2, '0')}:${String(sec2).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  };

  const header = `[Script Info]
Title: Snipply Captions
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Snipply,DejaVu Sans,45,&H00FFFFFF,&H00000000,&H00000000,&H7F000000,-1,0,0,0,100,100,2,0,3,5,2,2,60,60,300,1
Style: SnipplyBox,DejaVu Sans,47,&H00FFFFFF,&H00000000,&H00000000,&HC8000000,-1,0,0,0,100,100,2,0,1,5,2,2,60,60,300,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const body = events
    .map((e) => `Dialogue: 0,${fmt(e.start)},${fmt(e.end)},SnipplyBox,,0,0,0,,{\\fad(90,90)}${e.text.replace(/\n/g, ' ')}`)
    .join('\n');

  fs.writeFileSync(destPath, header + body + '\n', 'utf8');
  return destPath;
}

// Burn an .ass file into a video (1080x1920)
async function burnCaptions(inputPath, assPath, outputPath) {
  await execAsync(
    // eslint-disable-next-line max-len
    `ffmpeg -i "${inputPath}" -vf "ass=${assPath}" -c:v libx264 -preset veryfast -crf 23 -c:a copy -movflags +faststart "${outputPath}" -y`,
    { timeout: 10 * 60 * 1000 }
  );
  return outputPath;
}

module.exports = { buildAssFile, burnCaptions, groupWords };
