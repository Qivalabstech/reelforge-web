# ReelForge Web: GTA 6 reaction reels on Vercel

ReelForge Web is a website that turns a GTA 6 stream clip into a finished 9:16 reel. In each reel, Blocky (your 3D host) reacts to the clip and comments on it.

**How the work is split:**
- **Your browser** does the heavy work: rendering Blocky in 3D with lip sync, drawing the captions and exporting the MP4.
- **Vercel** runs small API functions:
  - `api/fetch.py` takes a Twitch or Kick link and cuts out just the part you need (about 35 seconds around the moment, or the whole clip). It uses yt-dlp and PyAV, and only downloads the video segments around the moment, not the whole VOD.
  - The other functions call Claude (to write the script) and ElevenLabs (for Blocky's voice and the streamer's transcript). They also keep your API keys secret.

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
   - Framework Preset: **Other**. Leave the build settings empty; `vercel.json` already sets them. Vercel installs the Python packages from `requirements.txt` by itself.
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

1. **Get the video, either way:**
   - **Paste a link** and press **Fetch video**:
     - **Twitch or Kick clip link:** the whole clip is fetched (up to 90 seconds).
     - **VOD link** (for example `twitch.tv/videos/123…`): add the moment time, like `1:23:45`. If the link already has `?t=1h23m45s`, the time is filled in for you. ReelForge fetches 25 seconds before that moment and 10 seconds after it.
     - **Stream that is still live:** on Twitch, the VOD of an ongoing stream exists at `twitch.tv/videos/…` while it is live (if the streamer saves VODs). Paste that link with the time, or make a Twitch clip and paste the clip link.
   - **Or upload a file:** any clip you downloaded, or any part of a VOD between 30 seconds and 10 minutes long.
2. **Check the peak.** The loudest moment near your time is picked as the peak. Click the loudness bar to change it, or pause the video on the moment and press **Use current video time**.
3. **Add details.** Enter the streamer's name, and optionally what happens in the clip. This helps the jokes.
4. **Make reel.** A 30-second reel takes about 1–3 minutes in Chrome or Edge on a normal laptop.
5. **Download and post.** Download the MP4, then copy the title and caption.

## Running it on your own computer (optional)

You need Node.js 20 or newer. Run `node dev-server.mjs`, then open http://localhost:3000. Link fetching also needs Python: run `pip install -r requirements.txt uvicorn` first, and the dev server starts the fetch function for you. To use real AI lines locally, put the same keys in a `.env` file in this folder.

## Notes

- **Browser:** use Chrome or Edge on a desktop. Safari and phones may not export video.
- **Audio format:** the reel's audio is AAC where the browser supports it. Otherwise it uses Opus, which the Linux version of Chrome needs. MP4 files with Opus audio play fine on YouTube; for Instagram, AAC is safest, so export from Chrome or Edge on Windows or a Mac.
- **Link fetching limits:**
  - **YouTube** usually blocks requests from cloud servers with a bot check. For YouTube, download the video on your PC and upload the file.
  - **Kick** sometimes refuses cloud servers too.
  - **Subscriber-only VODs** cannot be fetched.
  - **Speed:** each fetch takes roughly 5–60 seconds, within the 300-second function limit.
- **What Vercel can't do:** record a live stream continuously, or scan a whole VOD's chat to find the moments for you. Those jobs take minutes to hours and need a server. To do them automatically, use the desktop ReelForge (the Python version) on your PC or on a VPS.
- **Before posting:** the lines are AI-written, so watch every reel. Keep the streamer credit. Stop clipping anyone who asks you to.
- **Responsible clipping:** fetch only public clips and VODs, credit the streamer, and stop if a streamer asks you to.
- **Costs:** each reel makes one Claude call, two ElevenLabs voice generations and one short ElevenLabs transcription.
