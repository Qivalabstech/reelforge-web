import { body, checkAuth, env, onlyPost } from './_lib.js';

// ElevenLabs text-to-speech with character timestamps (used for lip sync and word-timed captions).
export default async function handler(req, res) {
  if (!onlyPost(req, res) || !checkAuth(req, res)) return;
  const key = env.elevenKey(), voice = env.elevenVoice();
  if (!key || !voice) return res.status(503).json({ error: 'ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID not set on Vercel' });
  const text = String(body(req).text || '').slice(0, 600);
  if (!text.trim()) return res.status(400).json({ error: 'No text' });
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/with-timestamps?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text, model_id: env.elevenModel(),
        voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: data?.detail?.message || data?.detail || `ElevenLabs error ${r.status}` });
    return res.status(200).json({ audio_base64: data.audio_base64, alignment: data.alignment || null });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
