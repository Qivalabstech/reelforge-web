import { body, checkAuth, env, onlyPost } from './_lib.js';

// Streamer speech -> word timestamps with ElevenLabs Speech to Text (Scribe).
// The page sends a short mono 16 kHz WAV (about 1 MB for 35 s) as base64.
export default async function handler(req, res) {
  if (!onlyPost(req, res) || !checkAuth(req, res)) return;
  const key = env.elevenKey();
  if (!key) return res.status(503).json({ error: 'ELEVENLABS_API_KEY not set on Vercel' });
  const b64 = String(body(req).wav_base64 || '');
  if (!b64) return res.status(400).json({ error: 'No audio' });
  try {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(b64, 'base64')], { type: 'audio/wav' }), 'clip.wav');
    form.append('model_id', env.sttModel());
    form.append('timestamps_granularity', 'word');
    form.append('tag_audio_events', 'false');
    const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST', headers: { 'xi-api-key': key }, body: form,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: data?.detail?.message || data?.detail || `ElevenLabs STT error ${r.status}` });
    const words = (data.words || []).filter(w => w.type === 'word')
      .map(w => ({ word: w.text, start: w.start, end: w.end }));
    return res.status(200).json({ words });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
