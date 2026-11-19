import { body, checkAuth, env, onlyPost } from './_lib.js';

const EXPRS = ['neutral', 'happy', 'laugh', 'shocked', 'angry', 'sad'];

const LANGS = {
  english: {
    lang: 'simple, punchy English',
    desc: 'casual, simple English with gamer slang that a global audience understands (no regional slang)',
    tts: 'exactly the same line as text',
  },
  hinglish: {
    lang: 'Hinglish in Roman script',
    desc: 'casual Hinglish (Hindi-English mix, like Indian gaming creators)',
    tts: 'the same line with Hindi words in Devanagari and English words in Latin script, for text-to-speech',
  },
};

const system = (name, L) => `You write short-form reaction scripts for a faceless gaming channel.
The channel's host is ${name}, a blocky cartoon gamer who reacts to clips from other streamers playing GTA 6.
${name} speaks ${L.desc}, and is funny, quick and hype.
Rules:
- Add real value: a joke, a roast of the gameplay, a sharp observation or a prediction. Never just describe the clip.
- Roast gameplay and moments only. No slurs, no insults about looks, identity, family or real life, no hate.
- Do not invent facts about the streamer. Do not reveal GTA 6 story spoilers beyond what is in the clip.
- Keep it tight: these are 20-40 second reels.
Return ONLY a JSON object, no prose.`;

const user = (c, name, L) => `Clip details
- Streamer: ${c.streamer} (${c.platform})
- What happens (from the uploader, may be empty): ${c.context || '(not given)'}
- Clip length: ${c.clip_len.toFixed(1)}s. The peak moment is at about ${c.peak.toFixed(1)}s.
- Streamer speech with timestamps (seconds into the clip):
${c.transcript || '(no speech detected)'}

Write JSON with exactly these keys:
{
  "hook": "on-screen hook, max 7 words, in ${L.lang}, creates curiosity",
  "pause_at": <seconds into the clip where ${name} pauses the clip to comment; just before the peak payoff, between 3 and ${Math.max(3, c.peak - 0.3).toFixed(1)}>,
  "hook_reaction": one of ${EXPRS.join('|')},
  "build_reaction": one of ${EXPRS.join('|')},
  "commentary": {"text": "1-2 sentences, max 24 words, in ${L.lang}, said while the clip is paused",
                 "tts": "${L.tts}",
                 "expression": one of ${EXPRS.join('|')}},
  "payoff_reaction": one of ${EXPRS.join('|')},
  "punchline": {"text": "max 16 words, in ${L.lang}, ends with a question for viewers to answer in comments",
                "tts": "${L.tts}",
                "expression": one of ${EXPRS.join('|')}},
  "title": "YouTube Shorts title under 70 characters with the streamer name and GTA 6",
  "caption": "Instagram/Facebook caption, 1-2 lines, in ${L.lang}, credit the streamer with @${c.streamer}",
  "hashtags": ["5 to 8 hashtags, include #gta6"]
}`;

export default async function handler(req, res) {
  if (!onlyPost(req, res) || !checkAuth(req, res)) return;
  const key = env.claudeKey();
  if (!key) return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not set on Vercel' });
  const b = body(req);
  const c = {
    streamer: String(b.streamer || 'streamer').slice(0, 60),
    platform: String(b.platform || 'Twitch').slice(0, 20),
    context: String(b.context || '').slice(0, 400),
    clip_len: Number(b.clip_len) || 30,
    peak: Number(b.peak) || 20,
    transcript: String(b.transcript || '').slice(0, 4000),
  };
  const L = LANGS[b.language] || LANGS.english;
  const name = env.characterName();
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: env.claudeModel(), max_tokens: 1200,
        system: system(name, L),
        messages: [{ role: 'user', content: user(c, name, L) }],
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: data?.error?.message || `Claude error ${r.status}` });
    const text = (data.content || []).filter(x => x.type === 'text').map(x => x.text).join('');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return res.status(502).json({ error: 'Claude did not return JSON' });
    return res.status(200).json(JSON.parse(m[0]));
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
