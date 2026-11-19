"""Fetch the part of a stream we need from a link (Twitch / Kick clip or VOD, YouTube where allowed).

POST /api/fetch  {"url": "...", "time": seconds-or-null}
  -> streams back an MP4 of about 35 seconds around the moment (or the whole clip, up to 90 s)
     with clip details in the X-Clip-Meta header (URL-encoded JSON).

Runs on Vercel's Python runtime as a raw ASGI app (streaming responses have no 4.5 MB limit).
Uses yt-dlp to find the media URL and PyAV (FFmpeg libraries in a Python wheel) to cut the section
without re-encoding. Only the HLS segments around the moment are downloaded.
"""
import asyncio
import json
import os
import re
import shutil
import tempfile
import urllib.parse

BEFORE, AFTER, MAX_LEN = 25.0, 10.0, 90.0


def parse_time(v):
    """'1h2m3s', '1:02:03', '3723', 3723 -> seconds."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().lower()
    m = re.fullmatch(r"(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s?)?", s)
    if m and any(m.groups()):
        h, mi, se = m.groups()
        return int(h or 0) * 3600 + int(mi or 0) * 60 + float(se or 0)
    if re.fullmatch(r"[\d:.]+", s):
        t = 0.0
        for p in s.split(":"):
            t = t * 60 + float(p or 0)
        return t
    return None


def time_from_url(url):
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    for k in ("t", "start", "time_continue"):
        if k in q:
            return parse_time(q[k][0])
    return None


def platform_of(info):
    k = (info.get("extractor_key") or info.get("extractor") or "").lower()
    for name in ("twitch", "kick", "youtube"):
        if name in k:
            return {"twitch": "Twitch", "kick": "Kick", "youtube": "YouTube"}[name]
    return info.get("extractor_key") or "Stream"


def extract(url):
    import yt_dlp
    opts = {"quiet": True, "no_warnings": True, "skip_download": True, "noplaylist": True,
            "socket_timeout": 20,
            "format": "best[height<=720][vcodec^=avc][acodec!=none]/best[height<=720][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]/best[height<=720]/best"}
    with yt_dlp.YoutubeDL(opts) as y:
        info = y.extract_info(url, download=False)
    if info.get("_type") == "playlist" and info.get("entries"):
        info = next(e for e in info["entries"] if e)
    return info


def source_of(info):
    f = (info.get("requested_formats") or [info])[0]
    if not f.get("url"):
        raise RuntimeError("No playable stream found for that link.")
    hdr = "".join(f"{k}: {v}\r\n" for k, v in (f.get("http_headers") or {}).items())
    return f["url"], hdr


def friendly(err):
    s = str(err)
    if "confirm you" in s and "bot" in s:
        return "YouTube blocked the server (bot check). Download this one on your PC and upload the file instead."
    if "Unsupported URL" in s:
        return "That link is not supported. Use a Twitch or Kick clip/VOD link."
    if "403" in s or "Forbidden" in s:
        return "The site refused the server (403). Try again later, or upload the file instead."
    if "404" in s or "not found" in s.lower():
        return "Video not found (404). Check the link, or the VOD may have been deleted."
    if "sub-only" in s.lower() or "subscriber" in s.lower():
        return "That VOD is for subscribers only, so the server cannot fetch it."
    if "is offline" in s or "not currently live" in s:
        return "That channel is offline. Use a VOD or clip link."
    return s.replace("ERROR: ", "")[:300]


def cut(info, start, dur, out_path):
    """Copy (no re-encode) about `dur` seconds starting at the keyframe at or before `start`."""
    import av
    url, hdr = source_of(info)
    opts = {"rw_timeout": "30000000", "reconnect": "1"}
    if hdr:
        opts["headers"] = hdr
    src = av.open(url, options=opts, timeout=30)
    try:
        v = src.streams.video[0]
        a = src.streams.audio[0] if src.streams.audio else None
        t0 = (src.start_time or 0) / 1_000_000  # container timestamps may not start at 0 (HLS)
        if start > 0:
            src.seek(int((start + t0) * 1_000_000), backward=True, any_frame=False)
        out = av.open(out_path, "w", format="mp4", options={"movflags": "+faststart"})
        ov = out.add_stream_from_template(v)
        oa = out.add_stream_from_template(a) if a else None
        first, last_dts = None, {}
        for pkt in src.demux([s for s in (v, a) if s]):
            if pkt.dts is None or pkt.pts is None:
                continue
            ts = float(pkt.pts * pkt.time_base) - t0
            if first is None:
                if pkt.stream is v and pkt.is_keyframe and ts >= start - 12:
                    first = ts
                else:
                    continue
            if ts < first - 0.05:
                continue
            if ts - first > dur:
                if pkt.stream is v:
                    break
                continue
            off = int(round((first + t0) / pkt.time_base))
            pkt.pts -= off
            pkt.dts -= off
            key = pkt.stream.index
            if pkt.dts < 0 or (key in last_dts and pkt.dts <= last_dts[key]):
                continue
            last_dts[key] = pkt.dts
            pkt.stream = ov if pkt.stream is v else oa
            out.mux(pkt)
        out.close()
    finally:
        src.close()
    if first is None or not os.path.exists(out_path) or os.path.getsize(out_path) < 10_000:
        raise RuntimeError("Could not cut that part of the video.")
    return first


def prepare(url, t):
    info = extract(url)
    live = bool(info.get("is_live"))
    duration = float(info.get("duration") or 0)
    if t is None:
        t = time_from_url(url)
    if live:
        raise RuntimeError("That stream is live right now. Paste the live VOD link (twitch.tv/videos/...) with the time, "
                           "or make a Twitch clip and paste the clip link.")
    if t is None:
        if duration and duration > MAX_LEN:
            raise RuntimeError("This is a long video. Add the moment time (for example 1:23:45) or use a link with ?t=.")
        start, dur, hint = 0.0, min(duration or MAX_LEN, MAX_LEN), None
    else:
        start = max(0.0, t - BEFORE)
        end = t + AFTER if not duration else min(duration, t + AFTER)
        dur, hint = max(3.0, end - start), t - start
    meta = {"title": info.get("title") or "", "uploader": info.get("uploader") or info.get("channel") or "",
            "platform": platform_of(info), "start": start, "duration": dur, "peak_hint": hint,
            "source_duration": duration}
    return info, start, dur, meta


async def _body(receive):
    chunks = []
    while True:
        m = await receive()
        chunks.append(m.get("body", b""))
        if not m.get("more_body"):
            return b"".join(chunks)


async def _json(send, status, obj):
    data = json.dumps(obj).encode()
    await send({"type": "http.response.start", "status": status,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(data)).encode())]})
    await send({"type": "http.response.body", "body": data})


async def app(scope, receive, send):
    if scope["type"] != "http":
        return
    headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
    if scope["method"] == "GET":
        return await _json(send, 200, {"ok": True})
    if scope["method"] != "POST":
        return await _json(send, 405, {"error": "Use POST"})
    pw = os.environ.get("APP_PASSWORD")
    if pw and headers.get("x-app-password") != pw:
        return await _json(send, 401, {"error": "Wrong or missing password"})
    try:
        req = json.loads((await _body(receive)) or b"{}")
    except ValueError:
        return await _json(send, 400, {"error": "Bad JSON"})
    url = str(req.get("url") or "").strip()
    if not re.match(r"^https?://", url):
        return await _json(send, 400, {"error": "Paste a full link starting with https://"})
    tmpdir = tempfile.mkdtemp()
    out = os.path.join(tmpdir, "clip.mp4")
    try:
        loop = asyncio.get_running_loop()
        info, start, dur, meta = await loop.run_in_executor(None, prepare, url, parse_time(req.get("time")))
        actual = await loop.run_in_executor(None, cut, info, start, dur, out)
        if meta.get("peak_hint") is not None and actual is not None:
            meta["peak_hint"] = round(meta["peak_hint"] + (start - actual), 2)
            meta["start"] = actual
    except Exception as e:
        shutil.rmtree(tmpdir, ignore_errors=True)
        return await _json(send, 422, {"error": friendly(e)})
    size = os.path.getsize(out)
    await send({"type": "http.response.start", "status": 200, "headers": [
        (b"content-type", b"video/mp4"), (b"content-length", str(size).encode()),
        (b"x-clip-meta", urllib.parse.quote(json.dumps(meta)).encode()),
        (b"cache-control", b"no-store")]})
    with open(out, "rb") as f:
        while True:
            chunk = f.read(512 * 1024)
            if not chunk:
                break
            await send({"type": "http.response.body", "body": chunk, "more_body": True})
    await send({"type": "http.response.body", "body": b""})
    shutil.rmtree(tmpdir, ignore_errors=True)
