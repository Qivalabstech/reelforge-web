// ReelForge Web: everything heavy (video, 3D render, captions, MP4 export) runs in this browser tab.
// The Vercel API functions only call Claude (script) and ElevenLabs (voice, transcript).
import { createAvatar } from './avatar.js';
import { Muxer, ArrayBufferTarget } from './lib/mp4-muxer.mjs';

const FPS = 30, W = 1080, H = 1920, TOP = 1152, AVH = H - TOP;
const FONT = 'Montserrat, "Arial Black", Arial, sans-serif';
const EXPRS = ['neutral', 'happy', 'laugh', 'shocked', 'angry', 'sad'];
const $ = (s) => document.querySelector(s);
const S = { file: null, buffer: null, duration: 0, peak: null, loud: [], health: null, words: [], script: null, win: null, avatar: null, url: null };

// ---------------------------------------------------------------- API + auth
const getPw = () => { try { return localStorage.getItem('rf_pw') || ''; } catch { return ''; } };
const setPw = (v) => { try { localStorage.setItem('rf_pw', v); } catch {} };
async function api(path, payload) {
  const r = await fetch('/api/' + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-app-password': getPw() }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
}
async function loadHealth() {
  try {
    const r = await fetch('/api/health', { headers: { 'x-app-password': getPw() } });
    if (!r.ok) throw new Error();
    return await r.json();
  } catch { return { password_required: false, authorized: true, claude: false, voice: false, transcribe: false, offline: true }; }
}

// ---------------------------------------------------------------- UI helpers
const logEl = () => $('#log');
function log(msg, kind = '') { const li = document.createElement('li'); li.textContent = msg; if (kind) li.className = kind; logEl().appendChild(li); li.scrollIntoView({ block: 'nearest' }); }
function progress(p, label) { $('#bar').style.width = Math.round(p * 100) + '%'; if (label) $('#barLabel').textContent = label; }
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function renderChips() {
  const h = S.health, c = $('#chips');
  const chip = (ok, on, off) => `<span class="chip ${ok ? 'ok' : 'off'}">${ok ? on : off}</span>`;
  c.innerHTML = chip(h.claude, 'Claude script: on', 'Claude script: off (template lines)') +
    chip(h.voice, 'ElevenLabs voice: on', 'Voice: off (placeholder)') +
    chip(h.transcribe, 'Streamer captions: on', 'Streamer captions: off');
  $('#demoNote').hidden = h.claude && h.voice;
}

// ---------------------------------------------------------------- loading the clip
async function onFile(file, opts = {}) {
  if (!file) return;
  S.file = file;
  const v = $('#video');
  if (S.srcUrl) URL.revokeObjectURL(S.srcUrl);
  S.srcUrl = URL.createObjectURL(file);
  v.src = S.srcUrl;
  await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('This browser cannot play that video file. Try an MP4 (H.264).')); });
  S.duration = v.duration;
  $('#clipInfo').textContent = `${file.name} · ${fmt(S.duration)} · ${v.videoWidth}×${v.videoHeight}`;
  $('#step2').hidden = false;
  S.buffer = null; S.loud = [];
  try {
    const ac = new AudioContext({ sampleRate: 48000 });
    S.buffer = await ac.decodeAudioData(await file.arrayBuffer());
    ac.close();
    S.loud = loudness(S.buffer, 0.5);
    let lo = 4, hi = S.loud.length - 2;
    if (opts.peakHint != null) { lo = Math.max(0, Math.floor((opts.peakHint - 6) / 0.5)); hi = Math.min(S.loud.length, Math.ceil((opts.peakHint + 4) / 0.5)); }
    let best = lo;
    for (let i = lo; i < hi; i++) if (S.loud[i] > S.loud[best]) best = i;
    setPeak(S.loud.length > 8 ? best * 0.5 + 0.25 : Math.min(S.duration * 0.7, S.duration - 3));
  } catch (e) {
    log('No audio track found; the reel will have only Blocky’s voice.', 'warn');
    setPeak(opts.peakHint != null ? opts.peakHint : Math.min(S.duration * 0.7, Math.max(3, S.duration - 3)));
  }
}

function loudness(buf, step) {
  const d = buf.getChannelData(0), n = Math.floor(buf.length / (buf.sampleRate * step)), hop = Math.floor(buf.sampleRate * step), out = [];
  for (let i = 0; i < n; i++) { let s = 0; for (let j = i * hop; j < (i + 1) * hop; j += 4) s += d[j] * d[j]; out.push(10 * Math.log10(s / (hop / 4) + 1e-9)); }
  return out;
}

function setPeak(t) {
  S.peak = clamp(t, 1.5, Math.max(1.5, S.duration - 0.5));
  $('#peakLabel').textContent = fmt(S.peak) + ` (${S.peak.toFixed(1)}s)`;
  drawStrip();
}

function drawStrip() {
  const c = $('#strip'), g = c.getContext('2d');
  const w = c.width = c.clientWidth * devicePixelRatio, h = c.height = 56 * devicePixelRatio;
  g.clearRect(0, 0, w, h);
  if (S.loud.length) {
    const mn = Math.min(...S.loud), mx = Math.max(...S.loud), bw = w / S.loud.length;
    g.fillStyle = '#4b3a85';
    S.loud.forEach((v, i) => { const k = (v - mn) / (mx - mn + 1e-6); g.fillRect(i * bw, h - k * h, Math.max(1, bw - 1), k * h); });
  }
  if (S.peak != null && S.duration) {
    const x = S.peak / S.duration * w;
    g.fillStyle = 'rgba(255,79,163,.25)';
    g.fillRect((S.peak - 25) / S.duration * w, 0, 33 / S.duration * w, h);
    g.fillStyle = '#ff4fa3'; g.fillRect(x - 2 * devicePixelRatio, 0, 4 * devicePixelRatio, h);
  }
  const v = $('#video');
  if (S.duration) { g.fillStyle = '#33e1ff'; g.fillRect(v.currentTime / S.duration * w, 0, 2 * devicePixelRatio, h); }
}

// ---------------------------------------------------------------- script, voice, transcript
function fallbackScript(ctx, lang) {
  const en = lang !== 'hinglish';
  const lines = en
    ? [['Wait wait wait, what is the plan here? I already know how this ends!', 'shocked'], ['That much confidence? He really thought physics took the day off in GTA 6.', 'laugh'], ['I watched this once and my controller fell out of my hands.', 'shocked']]
    : [['Bhai ruko ruko, yeh kya plan hai? Mujhe already pata hai kya hone wala hai!', 'shocked'], ['Itna confidence? Bhai ne socha GTA 6 mein physics chhutti pe hai.', 'laugh']];
  const punch = en ? [['What would you have done here? Tell me in the comments!', 'happy'], ['Rate this play out of ten. Go!', 'laugh']] : [['Aap hote toh kya karte? Comment mein batao!', 'happy']];
  const [c, ce] = lines[Math.floor(Math.random() * lines.length)], [p, pe] = punch[Math.floor(Math.random() * punch.length)];
  return {
    hook: en ? 'He did NOT just do that' : 'Yeh kya ho gaya bhai?!', pause_at: Math.max(3, ctx.peak - 1.5),
    hook_reaction: 'shocked', build_reaction: 'neutral', payoff_reaction: 'laugh',
    commentary: { text: c, tts: c, expression: ce }, punchline: { text: p, tts: p, expression: pe },
    title: `${ctx.streamer} in GTA 6 be like... #shorts`, caption: `${en ? 'This moment is legendary' : 'Yeh moment toh legendary hai'} 😂 Clip: @${ctx.streamer}`,
    hashtags: ['#gta6', '#gta6clips', '#gaming', '#shorts', '#reels'],
  };
}
function cleanScript(s, ctx) {
  const ex = (v, d) => EXPRS.includes(v) ? v : d;
  s.pause_at = clamp(Number(s.pause_at) || ctx.peak - 1.5, 3, Math.max(3, ctx.peak - 0.3));
  s.hook = String(s.hook || 'Did that just happen?!').trim();
  s.hook_reaction = ex(s.hook_reaction, 'shocked'); s.build_reaction = ex(s.build_reaction, 'neutral'); s.payoff_reaction = ex(s.payoff_reaction, 'laugh');
  for (const [k, d] of [['commentary', 'shocked'], ['punchline', 'happy']]) {
    const p = s[k] || {}; p.text = String(p.text || 'Did that just happen?!').trim(); p.tts = String(p.tts || p.text).trim(); p.expression = ex(p.expression, d); s[k] = p;
  }
  s.title = s.title || `${ctx.streamer} GTA 6 moment`; s.caption = s.caption || ''; s.hashtags = Array.isArray(s.hashtags) ? s.hashtags : ['#gta6'];
  return s;
}

function wordsFromAlignment(al) {
  const out = []; let cur = '', s0 = null, e0 = null;
  const ch = al?.characters || [], st = al?.character_start_times_seconds || [], en = al?.character_end_times_seconds || [];
  for (let i = 0; i < ch.length; i++) {
    if (/\s/.test(ch[i])) { if (cur) out.push({ word: cur, start: s0, end: e0 }); cur = ''; s0 = null; continue; }
    if (s0 === null) s0 = st[i]; cur += ch[i]; e0 = en[i];
  }
  if (cur) out.push({ word: cur, start: s0, end: e0 });
  return out;
}

function babble(text) { // placeholder voice so the app works before keys are set
  const sr = 48000, ws = text.split(/\s+/).filter(Boolean), dur = 0.3 * ws.length + 0.3;
  const buf = new AudioBuffer({ length: Math.ceil(sr * dur), numberOfChannels: 1, sampleRate: sr }), d = buf.getChannelData(0);
  let ph = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr, syl = 0.5 - 0.5 * Math.cos(2 * Math.PI * 5.5 * t), f0 = 150 + 30 * Math.sin(2 * Math.PI * 0.7 * t);
    ph += 2 * Math.PI * f0 / sr;
    d[i] = t > dur - 0.25 ? 0 : (Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.3 * Math.sin(3.1 * ph)) * syl * 0.25;
  }
  return { buf, words: ws.map((w, i) => ({ word: w, start: 0.3 * i, end: 0.3 * i + 0.28 })) };
}

async function speak(part) {
  const caption = part.text.split(/\s+/).filter(Boolean);
  if (!S.health.voice) return babble(part.text);
  const r = await api('tts', { text: part.tts || part.text });
  const bytes = Uint8Array.from(atob(r.audio_base64), (c) => c.charCodeAt(0));
  const ac = new AudioContext({ sampleRate: 48000 });
  const buf = await ac.decodeAudioData(bytes.buffer); ac.close();
  const spoken = wordsFromAlignment(r.alignment);
  const dur = buf.duration;
  const words = caption.map((w, i) => {
    if (!spoken.length) return { word: w, start: dur * i / caption.length, end: dur * (i + 1) / caption.length };
    const j = Math.min(spoken.length - 1, Math.floor(i * spoken.length / caption.length));
    return { word: w, start: spoken[j].start, end: spoken[j].end };
  });
  return { buf, words };
}

function b64(buf) { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }

async function windowWav(a, b) {
  const sr = 16000, len = Math.ceil((b - a) * sr), oc = new OfflineAudioContext(1, len, sr);
  const src = oc.createBufferSource(); src.buffer = S.buffer; src.connect(oc.destination); src.start(0, a, b - a);
  const d = (await oc.startRendering()).getChannelData(0);
  const ab = new ArrayBuffer(44 + d.length * 2), v = new DataView(ab);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + d.length * 2, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, d.length * 2, true);
  for (let i = 0; i < d.length; i++) v.setInt16(44 + i * 2, clamp(d[i], -1, 1) * 32767, true);
  return b64(ab);
}

function transcriptText(words, offset) {
  const lines = []; let cur = [], t0 = null;
  for (const w of words) {
    if (t0 === null) t0 = w.start - offset; cur.push(w.word);
    if (cur.length >= 10 || /[.?!]$/.test(w.word)) { lines.push(`[${t0.toFixed(1)}] ${cur.join(' ')}`); cur = []; t0 = null; }
  }
  if (cur.length) lines.push(`[${t0.toFixed(1)}] ${cur.join(' ')}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- lip sync from voice audio
function visemes(buf) {
  const d = buf.getChannelData(0), sr = buf.sampleRate, hop = Math.floor(sr / FPS), n = Math.max(1, Math.floor(d.length / hop));
  const rms = [], zcr = [];
  for (let i = 0; i < n; i++) {
    let s = 0, z = 0;
    for (let j = i * hop + 1; j < (i + 1) * hop; j++) { s += d[j] * d[j]; if ((d[j] >= 0) !== (d[j - 1] >= 0)) z++; }
    rms.push(Math.sqrt(s / hop)); zcr.push(z / hop);
  }
  const sorted = [...rms].sort((a, b) => a - b), ref = sorted[Math.floor(sorted.length * 0.95)] + 1e-6;
  const voiced = zcr.filter((_, i) => rms[i] > ref * 0.2).sort((a, b) => a - b), zmed = voiced[Math.floor(voiced.length / 2)] || 0.05;
  let prev = [0, 0, 0, 0, 0]; const out = [];
  for (let i = 0; i < n; i++) {
    const open = clamp((rms[i] / ref - 0.12) * 1.5, 0, 1), zr = zcr[i] / zmed;
    const hi = clamp((zr - 1) * 1.5, 0, 1), lo = clamp((1 - zr) * 1.8, 0, 1), mid = clamp(1 - hi - lo, 0, 1);
    const v = [open * mid * 1.0, open * hi * 0.5, open * lo * 0.4, open * hi * 0.9, open * lo * 0.9];
    prev = prev.map((p, k) => p + (v[k] - p) * 0.6);
    out.push(prev.map((x) => Math.round(x * 1000) / 1000));
  }
  return out;
}

// ---------------------------------------------------------------- captions
function chunks(words, maxWords = 3, maxChars = 18) {
  const groups = []; let cur = [];
  for (const w of words) {
    if (cur.length && (cur.length >= maxWords || [...cur, w].map((x) => x.word).join(' ').length > maxChars)) { groups.push(cur); cur = []; }
    cur.push(w);
  }
  if (cur.length) groups.push(cur);
  return groups.map((c, i) => ({ text: c.map((x) => x.word).join(' '), start: c[0].start, end: Math.max(i + 1 < groups.length ? groups[i + 1][0].start : c[c.length - 1].end + 0.25, c[0].start + 0.2) }));
}
function wrap(g, text, maxW) {
  const out = []; let line = '';
  for (const w of text.split(/\s+/)) { const t = line ? line + ' ' + w : w; if (line && g.measureText(t).width > maxW) { out.push(line); line = w; } else line = t; }
  if (line) out.push(line);
  return out;
}
function outlined(g, text, x, y, size, fill, stroke) {
  g.font = `900 ${size}px ${FONT}`;
  let s = size; while (g.measureText(text).width > 1000 && s > 30) { s -= 4; g.font = `900 ${s}px ${FONT}`; }
  g.lineJoin = 'round'; g.lineWidth = Math.max(6, s * 0.16); g.strokeStyle = stroke; g.strokeText(text, x, y);
  g.fillStyle = fill; g.fillText(text, x, y);
}
function drawCaptions(g, t, C) {
  g.textAlign = 'center'; g.textBaseline = 'middle';
  // hook banner
  g.font = `900 58px ${FONT}`;
  const lines = wrap(g, C.hook, 900), lh = 70, bw = Math.max(...lines.map((l) => g.measureText(l).width)) + 56, bh = lines.length * lh + 30;
  g.fillStyle = '#ff4fa3'; g.beginPath(); g.roundRect(540 - bw / 2, 54, bw, bh, 22); g.fill();
  g.fillStyle = '#ffffff'; lines.forEach((l, i) => g.fillText(l, 540, 54 + 15 + lh / 2 + i * lh));
  // credit
  g.textAlign = 'right'; g.font = `700 26px ${FONT}`; g.fillStyle = 'rgba(255,255,255,.8)'; g.fillText(C.credit, 1056, TOP - 22);
  g.textAlign = 'center';
  // streamer captions
  const sc = C.stream.find((c) => t >= c.start && t < c.end);
  if (sc) outlined(g, sc.text, 540, TOP - 86, 46, '#ffffff', '#000000');
  // Blocky's captions (pop-in)
  const tc = C.talk.find((c) => t >= c.start && t < c.end);
  if (tc) {
    const k = t - tc.start, sc2 = k < 0.09 ? 0.8 + 0.25 * k / 0.09 : k < 0.16 ? 1.05 - 0.05 * (k - 0.09) / 0.07 : 1;
    g.save(); g.translate(540, TOP); g.scale(sc2, sc2); outlined(g, tc.text.toUpperCase(), 0, 0, 80, '#ffffff', '#000000'); g.restore();
  }
  if (C.cta && t >= C.ctaStart) outlined(g, C.cta, 540, H - 50, 42, '#ffd23f', '#000000');
}

// ---------------------------------------------------------------- frame drawing
function drawTop(g, v, zoom, freeze, mode) {
  const vw = v.videoWidth || 16, vh = v.videoHeight || 9;
  g.save(); g.beginPath(); g.rect(0, 0, W, TOP); g.clip();
  g.fillStyle = '#000'; g.fillRect(0, 0, W, TOP);
  if (mode === 'fill') {
    const s = Math.max(W / vw, TOP / vh) * zoom;
    g.filter = freeze ? 'saturate(0.85)' : 'none';
    g.drawImage(v, (W - vw * s) / 2, (TOP - vh * s) / 2, vw * s, vh * s);
  } else {
    const cs = Math.max(W / vw, TOP / vh) * 1.05;
    g.filter = 'blur(26px) brightness(0.75)';
    g.drawImage(v, (W - vw * cs) / 2, (TOP - vh * cs) / 2, vw * cs, vh * cs);
    const s = Math.min(W / vw, TOP / vh) * zoom;
    g.filter = freeze ? 'saturate(0.85)' : 'none';
    g.drawImage(v, (W - vw * s) / 2, (TOP - vh * s) / 2, vw * s, vh * s);
  }
  g.restore(); g.filter = 'none';
}
function seekTo(v, t) {
  return new Promise((res) => {
    let done = false;
    const fin = () => { if (done) return; done = true; v.removeEventListener('seeked', fin); res(); };
    v.addEventListener('seeked', fin);
    v.currentTime = Math.min(Math.max(0, t), v.duration - 0.02);
    setTimeout(fin, 3000);
  });
}

// ---------------------------------------------------------------- audio + encoding
async function mixAudio(plan, voices, total) {
  const oc = new OfflineAudioContext(2, Math.ceil(total * 48000), 48000);
  const comp = oc.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 4; comp.connect(oc.destination);
  const sg = oc.createGain(); sg.gain.value = 0.9; sg.connect(comp);
  const vg = oc.createGain(); vg.gain.value = 1.5; vg.connect(comp);
  if (S.buffer) for (const p of plan) if (p.kind === 'play') { const s = oc.createBufferSource(); s.buffer = S.buffer; s.connect(sg); s.start(p.t0, p.start, p.dur); }
  for (const v of voices) { const s = oc.createBufferSource(); s.buffer = v.buf; s.connect(vg); s.start(v.off); }
  const out = await oc.startRendering();
  let peak = 0; for (let c = 0; c < 2; c++) for (const x of out.getChannelData(c)) peak = Math.max(peak, Math.abs(x));
  if (peak > 0) { const k = 0.89 / peak; for (let c = 0; c < 2; c++) { const d = out.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= k; } }
  return out;
}
async function pickCodecs() {
  let vcodec = null, acodec = null;
  for (const c of ['avc1.640028', 'avc1.4d0028', 'avc1.42002a', 'avc1.640033']) {
    try { if ((await VideoEncoder.isConfigSupported({ codec: c, width: W, height: H, bitrate: 8e6, framerate: FPS })).supported) { vcodec = c; break; } } catch {}
  }
  for (const c of ['mp4a.40.2', 'opus']) {
    try { if ((await AudioEncoder.isConfigSupported({ codec: c, sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 })).supported) { acodec = c; break; } } catch {}
  }
  return { vcodec, acodec };
}
async function encodeAudio(buf, muxer, codec) {
  let err = null;
  const enc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { err = e; } });
  enc.configure({ codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 });
  const L = buf.getChannelData(0), R = buf.getChannelData(1), N = 1024;
  for (let i = 0; i < buf.length; i += N) {
    const n = Math.min(N, buf.length - i), data = new Float32Array(n * 2);
    data.set(L.subarray(i, i + n), 0); data.set(R.subarray(i, i + n), n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i * 1e6 / 48000), data });
    enc.encode(ad); ad.close();
    if (enc.encodeQueueSize > 50) await new Promise((r) => setTimeout(r, 0));
  }
  await enc.flush(); enc.close();
  if (err) throw err;
}

// ---------------------------------------------------------------- the reel
async function makeReel() {
  if (!window.VideoEncoder || !window.AudioEncoder) { log('This browser cannot export video. Use Chrome or Edge on a computer.', 'err'); return; }
  lock(true); $('#log').innerHTML = ''; $('#result').hidden = true; progress(0, 'Starting');
  try {
    const lang = $('#lang').value, streamer = $('#streamer').value.trim().replace(/^@/, '') || 'streamer';
    const platform = $('#platform').value, context = $('#context').value.trim();
    const L = S.duration, peak = S.peak, win0 = Math.max(0, peak - 25), win1 = Math.min(L, peak + 8);
    S.win = { win0, win1, peak, streamer, platform, lang };
    S.words = [];
    if (S.health.transcribe && S.buffer && $('#streamCaps').checked) {
      log('Transcribing the streamer'); progress(0.03, 'Transcribing');
      try { const r = await api('transcribe', { wav_base64: await windowWav(win0, win1) }); S.words = r.words.map((w) => ({ ...w, start: w.start + win0, end: w.end + win0 })); log(`  ${S.words.length} words`); }
      catch (e) { log('  Transcript failed: ' + e.message, 'warn'); }
    }
    const ctx = { streamer, platform, context, clip_len: win1 - win0, peak: peak - win0, transcript: transcriptText(S.words, win0), language: lang };
    let script;
    log('Writing Blocky’s lines'); progress(0.08, 'Writing script');
    if (S.health.claude) { try { script = await api('script', ctx); } catch (e) { log('  Claude failed (' + e.message + '), using template lines', 'warn'); } }
    if (!script) script = fallbackScript(ctx, lang);
    S.script = cleanScript(script, ctx);
    fillScriptForm();
    await renderReel();
  } catch (e) { log('Failed: ' + (e.message || e), 'err'); console.error(e); }
  finally { lock(false); }
}

async function rerender() {
  lock(true); $('#log').innerHTML = '';
  try { readScriptForm(); await renderReel(); } catch (e) { log('Failed: ' + (e.message || e), 'err'); console.error(e); } finally { lock(false); }
}

async function renderReel() {
  const sc = S.script, { win0, win1, peak, streamer, platform } = S.win;
  log('Voicing Blocky'); progress(0.12, 'Generating voice');
  const v1 = await speak(sc.commentary), v2 = await speak(sc.punchline);

  const pause = win0 + Math.min(sc.pause_at, peak - win0 - 0.3);
  const hookS = clamp(peak - 1.5, win0, Math.max(win0, win1 - 3)), hookD = Math.min(3, win1 - win0);
  const b0 = Math.max(win0, pause - 12), payEnd = Math.min(win1, Math.max(pause + 1.5, peak + 5));
  const plan = [{ name: 'hook', kind: 'play', start: hookS, dur: hookD }];
  if (pause - b0 >= 0.5) plan.push({ name: 'build', kind: 'play', start: b0, dur: pause - b0 });
  plan.push({ name: 'comment', kind: 'freeze', start: pause, dur: v1.buf.duration + 0.4 },
    { name: 'payoff', kind: 'play', start: pause, dur: Math.max(0.5, payEnd - pause) },
    { name: 'punch', kind: 'freeze', start: Math.max(0, payEnd - 0.05), dur: v2.buf.duration + 0.9 });
  const react = { hook: sc.hook_reaction, build: sc.build_reaction, comment: sc.commentary.expression, payoff: sc.payoff_reaction, punch: sc.punchline.expression };

  let t = 0; const segsAv = [], stream = [], talkLines = [], voices = []; let ctaStart = 0;
  for (const p of plan) {
    p.t0 = t; const isTalk = p.name === 'comment' || p.name === 'punch';
    segsAv.push({ start: t, end: t + p.dur, expr: react[p.name], talk: isTalk, look: isTalk ? 'camera' : 'up' });
    if (p.kind === 'play') for (const w of S.words) if (w.start >= p.start && w.start < p.start + p.dur) stream.push({ word: w.word, start: t + w.start - p.start, end: t + Math.min(w.end, p.start + p.dur) - p.start });
    const vo = p.name === 'comment' ? v1 : p.name === 'punch' ? v2 : null;
    if (vo) { const off = t + 0.15; voices.push({ buf: vo.buf, off }); talkLines.push(vo.words.map((w) => ({ word: w.word, start: w.start + off, end: w.end + off }))); if (p.name === 'punch') ctaStart = off; }
    t += p.dur;
  }
  const total = t, n = Math.round(total * FPS);
  const vis = Array.from({ length: n + 1 }, () => [0, 0, 0, 0, 0]);
  for (const v of voices) visemes(v.buf).forEach((x, k) => { const j = Math.round(v.off * FPS) + k; if (j <= n) vis[j] = x; });
  const C = { hook: sc.hook, credit: `Clip: ${streamer} on ${platform}`, stream: chunks(stream, 4, 26), talk: talkLines.flatMap((l) => chunks(l)), cta: $('#cta').value.trim(), ctaStart };

  log('Loading Blocky'); progress(0.16, 'Loading 3D');
  if (!S.avatar) S.avatar = await createAvatar(W, AVH);
  S.avatar.setup({ duration: total, fps: FPS, segments: segsAv, visemes: vis });
  await document.fonts.load(`900 58px Montserrat`).catch(() => {});

  log('Mixing audio'); progress(0.18, 'Mixing audio');
  const { vcodec, acodec } = await pickCodecs();
  if (!vcodec) throw new Error('This browser has no H.264 encoder. Use Chrome or Edge.');
  const mixed = await mixAudio(plan, voices, total);
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, fastStart: 'in-memory', firstTimestampBehavior: 'offset',
    video: { codec: 'avc', width: W, height: H, frameRate: FPS },
    audio: acodec ? { codec: acodec === 'opus' ? 'opus' : 'aac', numberOfChannels: 2, sampleRate: 48000 } : undefined });
  if (acodec) await encodeAudio(mixed, muxer, acodec);
  else log('  No audio encoder in this browser; video will be silent', 'warn');

  log(`Rendering ${n} frames`);
  let verr = null;
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { verr = e; } });
  venc.configure({ codec: vcodec, width: W, height: H, bitrate: 8e6, framerate: FPS, avc: { format: 'avc' } });
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  const v = $('#video'); v.pause();
  const mode = $('#layout').value;
  let last = -1, t0 = performance.now();
  for (let i = 0; i < n; i++) {
    if (verr) throw verr;
    const tt = i / FPS, seg = plan.find((p) => tt >= p.t0 && tt < p.t0 + p.dur) || plan[plan.length - 1];
    const ct = seg.kind === 'play' ? seg.start + (tt - seg.t0) : seg.start;
    if (Math.abs(ct - last) > 1e-3) { await seekTo(v, ct); last = ct; }
    const zoom = seg.kind === 'freeze' ? Math.min(1.08, 1 + 0.0016 * (tt - seg.t0) * FPS) : 1;
    drawTop(g, v, zoom, seg.kind === 'freeze', mode);
    g.drawImage(S.avatar.renderAt(tt), 0, TOP, W, AVH);
    drawCaptions(g, tt, C);
    if (i === Math.round(1.5 * FPS)) $('#thumb').src = canvas.toDataURL('image/jpeg', 0.7);
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
    venc.encode(frame, { keyFrame: i % (FPS * 2) === 0 }); frame.close();
    while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2));
    if (i % 10 === 0) { const el = (performance.now() - t0) / 1000, eta = el / (i + 1) * (n - i - 1); progress(0.2 + 0.78 * i / n, `Rendering ${i}/${n} · ~${Math.ceil(eta)}s left`); }
  }
  await venc.flush(); venc.close();
  if (verr) throw verr;
  muxer.finalize();
  const blob = new Blob([target.buffer], { type: 'video/mp4' });
  if (S.url) URL.revokeObjectURL(S.url);
  S.url = URL.createObjectURL(blob);
  window.__reelBlob = blob;
  showResult(blob, total);
  progress(1, 'Done');
  log(`Done: ${total.toFixed(1)}s reel, ${(blob.size / 1e6).toFixed(1)} MB`, 'ok');
}

// ---------------------------------------------------------------- result + script editing
function fillScriptForm() {
  const s = S.script;
  $('#e_hook').value = s.hook; $('#e_comment').value = s.commentary.text; $('#e_punch').value = s.punchline.text;
  $('#e_cexpr').value = s.commentary.expression; $('#e_pexpr').value = s.punchline.expression; $('#e_payoff').value = s.payoff_reaction;
}
function readScriptForm() {
  const s = S.script;
  const changed = (a, b) => a.trim() !== b.trim();
  s.hook = $('#e_hook').value.trim() || s.hook;
  const c = $('#e_comment').value.trim(), p = $('#e_punch').value.trim();
  if (c && changed(c, s.commentary.text)) { s.commentary.text = c; s.commentary.tts = c; }
  if (p && changed(p, s.punchline.text)) { s.punchline.text = p; s.punchline.tts = p; }
  s.commentary.expression = $('#e_cexpr').value; s.punchline.expression = $('#e_pexpr').value; s.payoff_reaction = $('#e_payoff').value;
}
function showResult(blob, total) {
  const s = S.script, name = `reel_${(S.win.streamer || 'clip').replace(/[^\w-]/g, '_')}_${Date.now().toString(36)}.mp4`;
  $('#result').hidden = false;
  $('#out').src = S.url;
  const a = $('#download'); a.href = S.url; a.download = name;
  $('#p_title').value = s.title; $('#p_caption').value = `${s.caption}\n\n${s.hashtags.join(' ')}`;
  $('#result').scrollIntoView({ behavior: 'smooth' });
}
function lock(on) { document.querySelectorAll('button, input, select, textarea').forEach((el) => { if (!el.closest('#result .copyrow')) el.disabled = on && !el.dataset.keep; }); }

// ---------------------------------------------------------------- wiring
async function init() {
  S.health = await loadHealth();
  if (S.health.password_required && !S.health.authorized) { $('#gate').hidden = false; $('#app').hidden = true; }
  else { $('#gate').hidden = true; $('#app').hidden = false; }
  renderChips();
}
$('#pwForm').addEventListener('submit', async (e) => { e.preventDefault(); setPw($('#pw').value); await init(); if (S.health.password_required && !S.health.authorized) $('#pwErr').hidden = false; });
$('#file').addEventListener('change', (e) => onFile(e.target.files[0]).catch((err) => log(err.message, 'err')));
const drop = $('#drop');
['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => onFile(e.dataTransfer.files[0]).catch((err) => log(err.message, 'err')));
$('#strip').addEventListener('click', (e) => { const r = e.currentTarget.getBoundingClientRect(); const t = (e.clientX - r.left) / r.width * S.duration; setPeak(t); $('#video').currentTime = S.peak; });
$('#useTime').addEventListener('click', () => setPeak($('#video').currentTime));
$('#video').addEventListener('timeupdate', drawStrip);
$('#make').addEventListener('click', makeReel);
$('#rerender').addEventListener('click', rerender);
document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($(b.dataset.copy).value); b.textContent = 'Copied'; setTimeout(() => (b.textContent = 'Copy'), 1500); } catch { $(b.dataset.copy).select(); }
}));

// ---------------------------------------------------------------- fetching from a link
function timeFromLink(u) {
  try {
    const t = new URL(u).searchParams.get('t'); if (!t) return '';
    const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
    if (!m) return t;
    const sec = (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
    return `${Math.floor(sec / 3600)}:${String(Math.floor(sec % 3600 / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  } catch { return ''; }
}
async function fetchLink(e) {
  e.preventDefault();
  const url = $('#link').value.trim(), st = $('#fetchStatus');
  if (!url) return;
  const btn = $('#fetchBtn'); btn.disabled = true;
  st.textContent = 'Finding the video and cutting the moment on the server (up to a minute)…';
  try {
    const r = await fetch('/api/fetch', { method: 'POST', headers: { 'content-type': 'application/json', 'x-app-password': getPw() },
      body: JSON.stringify({ url, time: $('#linkTime').value.trim() || null }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || (r.status === 404 ? 'Link fetching is not deployed (api/fetch.py missing).' : 'HTTP ' + r.status)); }
    let meta = {}; try { meta = JSON.parse(decodeURIComponent(r.headers.get('x-clip-meta') || '%7B%7D')); } catch {}
    const total = +r.headers.get('content-length') || 0, reader = r.body.getReader(), parts = []; let got = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; st.textContent = `Downloading ${(got / 1e6).toFixed(1)}${total ? ' / ' + (total / 1e6).toFixed(1) : ''} MB…`; }
    const file = new File(parts, (meta.uploader || 'clip').replace(/[^\w-]/g, '_') + '.mp4', { type: 'video/mp4' });
    if (meta.uploader && !$('#streamer').value) $('#streamer').value = meta.uploader;
    if (['Twitch', 'Kick', 'YouTube'].includes(meta.platform)) $('#platform').value = meta.platform;
    if (meta.title && !$('#context').value) $('#context').placeholder = meta.title.slice(0, 80);
    await onFile(file, { peakHint: meta.peak_hint });
    st.textContent = `Got ${fmt(meta.duration || S.duration)} from "${(meta.title || url).slice(0, 70)}".` + (meta.peak_hint != null ? ' Peak set near your time; adjust it below if needed.' : '');
  } catch (err) { st.textContent = 'Could not fetch: ' + err.message; }
  finally { btn.disabled = false; }
}
$('#linkForm').addEventListener('submit', fetchLink);
$('#link').addEventListener('change', () => { const t = timeFromLink($('#link').value.trim()); if (t && !$('#linkTime').value) $('#linkTime').value = t; });
addEventListener('resize', drawStrip);
init();
window.ReelForge = { S, onFile, setPeak, makeReel };
