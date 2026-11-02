# Mission 9 evidence artifacts

## `aftermath-demo-m9.mp4` — silent captioned demo (not committed)

- **Duration:** 1:31 (91.4 s)
- **Resolution:** 1920×1080, H.264 (yuv420p), AAC silent track
- **Captions:** burned in, from `aftermath-demo-m9.srt`
- **Source:** captured live from <https://aftermath-7tij.vercel.app/> with
  Playwright (Chromium), cut with ffmpeg
- **SHA-256:** see `SHA256SUMS.txt`
- **Scene timings:** `scene-timings.json` (captured from the recording clock)

The MP4 is **not committed** to keep the repository small. It exists at
`artifacts/mission9/aftermath-demo-m9.mp4` in the working tree. It is silent
because this environment has no TTS engine or microphone, so a fresh narrated
track could not be produced; the burned-in captions carry the narration. The
published, narrated video is the `demo-v2` release asset.

Every figure shown in the video is read from the live ledger at recording time
(`GET /api/overview`, `GET /api/memory`). No incident is invented, no hash is
fabricated, and no simulated write is presented as a Mainnet write.
