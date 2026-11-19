# ReelForge Web: GTA 6 reaction reels on Vercel

ReelForge Web is a website that turns a GTA 6 stream clip into a finished 9:16 reel. In each reel, Blocky (your 3D host) reacts to the clip and comments on it.

**How the work is split:**
- **Your browser** does the heavy work: cutting the video, rendering Blocky in 3D with lip sync, drawing the captions and exporting the MP4.
- **Vercel** runs three small API functions. They call Claude (to write the script) and ElevenLabs (for Blocky's voice and the streamer's transcript), and they keep your API keys secret.

## What one reel looks like

| Time | Top 60%: stream | Bottom 40%: Blocky |
|---|---|---|
| 0–3 s | The peak moment, as a teaser hook | Reacts |
| Next ~12 s | The build-up to the moment | Watches, looking up at the clip |
| Pause | Frozen frame with a slow zoom | Talks to camera (commentary) |
| Payoff | The moment plays out | Big reaction |
| End | Frozen frame | Punchline question, plus the end text |

On screen throughout: the hook banner, a streamer credit, the streamer's captions, and Blocky's word-by-word captions. You also get a title, caption and hashtags with Copy buttons. You can edit Blocky's lines and re-render.

---

## Deploy to Vercel (about 10 minutes, free Hobby plan works)

1. **Put the code on GitHub.**
   - Create a new **private** repository on github.com, for example `reelforge-web`.
   - Upload everything in this folder to it, either with "Add file → Upload files" or with GitHub Desktop.
2. **Import it on Vercel.**
   - On vercel.com, click **Add New → Project** and pick the repo.
   - Framework Preset: **Other**. Leave the build settings empty; `vercel.json` already sets them.
   - Click **Deploy**.
3. **Add your keys.** In the project, open **Settings → Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | Your Claude API key (console.anthropic.com) |
   | `ELEVENLABS_API_KEY` | Your ElevenLabs API key |
   | `ELEVENLABS_VOICE_ID` | The voice for Blocky (copy it from ElevenLabs → Voices) |
   | `APP_PASSWORD` | Any password. **Strongly recommended**: without it, anyone with the link can spend your API credits. |
   | `CLAUDE_MODEL` (optional) | Overrides the default `claude-sonnet-5-5` |
   | `CHARACTER_NAME` (optional) | Defaults to `Blocky` |

4. **Redeploy** so the keys take effect: Deployments → ⋯ → Redeploy.
5. **Use it.** Open your `.vercel.app` link, enter the password and upload a clip.

## Using it

1. **Get a clip.** On Twitch or Kick, use the stream's **Clip** button and download the MP4. You can also upload any part of a VOD between 30 seconds and 10 minutes long.
2. **Upload it.** The loudest moment is picked as the peak. Click the loudness bar to change it, or pause the video on the moment and press **Use current video time**.
3. **Add details.** Enter the streamer's name, and optionally what happens in the clip. This helps the jokes.
4. **Make reel.** A 30-second reel takes about 1–3 minutes in Chrome or Edge on a normal laptop.
5. **Download and post.** Download the MP4, then copy the title and caption.

## Running it on your own computer (optional)

You need Node.js 20 or newer. Run `node dev-server.mjs`, then open http://localhost:3000. To use real AI lines locally, put the same keys in a `.env` file in this folder.

## Notes

- **Browser:** use Chrome or Edge on a desktop. Safari and phones may not export video.
- **Audio format:** the reel's audio is AAC where the browser supports it. Otherwise it uses Opus, which the Linux version of Chrome needs. MP4 files with Opus audio play fine on YouTube; for Instagram, AAC is safest, so export from Chrome or Edge on Windows or a Mac.
- **What Vercel can't do:** download VODs or record live streams. Those jobs take minutes to hours and need a server. To do them automatically, use the desktop ReelForge (the Python version) on your PC or on a VPS.
- **Before posting:** the lines are AI-written, so watch every reel. Keep the streamer credit. Stop clipping anyone who asks you to.
- **Costs:** each reel makes one Claude call, two ElevenLabs voice generations and one short ElevenLabs transcription.
