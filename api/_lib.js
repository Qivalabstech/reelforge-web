// Shared helpers for the API functions. Files starting with "_" are not exposed as routes on Vercel.

export function checkAuth(req, res) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return true;
  if (req.headers['x-app-password'] === pw) return true;
  res.status(401).json({ error: 'Wrong or missing password' });
  return false;
}

export function onlyPost(req, res) {
  if (req.method === 'POST') return true;
  res.status(405).json({ error: 'Use POST' });
  return false;
}

export function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

export const env = {
  claudeKey: () => process.env.ANTHROPIC_API_KEY,
  claudeModel: () => process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
  elevenKey: () => process.env.ELEVENLABS_API_KEY,
  elevenVoice: () => process.env.ELEVENLABS_VOICE_ID,
  elevenModel: () => process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2',
  sttModel: () => process.env.ELEVENLABS_STT_MODEL || 'scribe_v2',
  characterName: () => process.env.CHARACTER_NAME || 'Blocky',
};
