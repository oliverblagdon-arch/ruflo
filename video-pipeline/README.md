# AI Video Pipeline

Modular, self-host pipeline: **idea → script → voiceover → stock visuals →
burned captions → platform-formatted render → publish** to YouTube, Instagram
Reels, and TikTok.

Every stage is a swappable adapter behind a typed interface. Change one env var
to switch tools; add a new tool by writing one class. No per-task SaaS fees —
the orchestration runs on your machine/VPS.

> **Honest scope:** this gets you ~85–90% of the way to hands-off for *faceless,
> assembly-style* content (stock footage + AI voiceover + captions). Two manual
> touchpoints remain by design — a quick quality check, and the TikTok publish.
> See [Where automation breaks](#where-automation-actually-breaks) before you
> scale. This is the accurate picture, not the optimistic one.

---

## Architecture

```
idea
 │
 ├─▶ [script]    OpenAI | Anthropic          → title, hook, body, hashtags, visual keywords
 ├─▶ [tts]       OpenAI | ElevenLabs         → voice.mp3 (+ measured duration)
 ├─▶ [captions]  Whisper                     → captions.srt (aligned to voice)
 ├─▶ [visuals]   Pexels stock (Lane A)       → N clips matching keywords
 ├─▶ [assembly]  FFmpeg                       → 1080x1920 (vertical) / 1920x1080 master, captions burned
 └─▶ [publish]   YouTube API · IG Graph · TikTok Content API
```

Stage contracts live in [`src/types.ts`](src/types.ts). Provider wiring is in
[`src/config.ts`](src/config.ts) — that's the only file you touch to swap tools.

---

## Quick start

```bash
cd video-pipeline
cp .env.example .env          # fill in keys (see below)
npm install
# Requires ffmpeg + ffprobe on PATH:  e.g. `apt install ffmpeg` / `brew install ffmpeg`

# Dry run — produce assets, skip publishing:
npm run produce -- --idea "Why octopuses have three hearts" --no-publish

# Real run, one idea:
npm run produce -- --idea "Why octopuses have three hearts" --niche "ocean facts"

# Batch from a file:
npm run produce -- --topics topics.example.json

# Schedule instead of posting now:
npm run produce -- --idea "..." --schedule "2026-06-20T15:00:00Z"
```

Outputs land in `output/<idea-id>/` (git-ignored): `voice.mp3`, `captions.srt`,
stock clips, and `video_vertical.mp4` / `video_horizontal.mp4`.

---

## Swapping tools (the modular part)

| Stage | Env var | Options today | How to add one |
|-------|---------|---------------|----------------|
| Script | `SCRIPT_PROVIDER` | `openai`, `anthropic` | implement `ScriptProvider`, add a case in `config.ts` |
| Voiceover | `TTS_PROVIDER` | `openai`, `elevenlabs` | implement `TtsProvider` |
| Visuals | `VISUALS_PROVIDER` | `pexels` | implement `VisualsProvider` (e.g. Pixabay, or a generative-AI adapter) |
| Captions | `CAPTIONS_PROVIDER` | `whisper` | implement `CaptionsProvider` |
| Assembly | `ASSEMBLY_PROVIDER` | `ffmpeg` | implement `AssemblyProvider` (e.g. Shotstack/JSON2Video API) |
| Publish | `PUBLISH_TARGETS` | `youtube,instagram,tiktok` | implement `Publisher` |

---

## Cost flags (watch these at scale)

- **ElevenLabs TTS** — usage-based by characters; the fastest-growing line item.
  Flip `TTS_PROVIDER=openai` when volume bites. Script + Whisper captions are cheap.
- **YouTube quota** — default **10,000 units/day, ~1,600 per upload → ~6 uploads/day**.
  Past that you must request a quota increase from Google (audited).
- **Generative AI video** is intentionally **not** the default. Clip length
  (~5–10s), character/scene consistency, and per-second cost don't yet make it a
  cheap mass-production engine. Lane A (stock assembly) is the scalable workhorse;
  add a generative adapter for accents once the rest works.

---

## Publishing setup notes

- **YouTube** — needs OAuth2 (client id/secret + a refresh token with the
  `youtube.upload` scope). Scheduling forces `privacyStatus=private` + `publishAt`.
- **Instagram Reels** — IG Business/Creator account linked to a Facebook Page,
  app review for content publishing, and the Graph API **pulls the video from a
  public URL**: host `output/` somewhere reachable and set `PUBLIC_BASE_URL`.
  Cap ≈ **25 API posts / 24h / account**.
- **TikTok** — see below. Defaults to the **draft inbox** flow (no audit needed);
  you tap Post in-app.

---

## Where automation actually breaks

1. **TikTok public auto-post.** Unaudited apps can only post `SELF_ONLY` or to
   the **draft inbox** — this scaffold uses drafts by default. Public auto-post
   requires passing TikTok's audit (not guaranteed for AI/automated content).
   Realistic options: tap Post manually, or route TikTok through an official
   partner scheduler (Buffer/Metricool/Publer).
2. **Quality control.** No reliable automated judge of "is this video good?".
   Keep a ~30-second human review before publish — highest-leverage manual step.
3. **Platform anti-automation enforcement.** All three platforms suppress or ban
   accounts that mass-post low-effort AI content. Post slower than you technically
   can; this scaffold makes the cap a choice, not a default.
4. **Generative AI video ceiling.** Length/consistency/cost — covered above.
5. **Music licensing & trend timing** still need a human or a curated source.

---

## Scheduling

`workflows/n8n-schedule.json` is a minimal **n8n** workflow: a Schedule Trigger
that runs the CLI on a cadence (the CLI does all the real work). Import it into a
self-hosted n8n, edit the install path, and set `topics.json`. Or just use cron:

```cron
0 */8 * * *  cd /opt/ai-video-pipeline && /usr/bin/npm run produce -- --topics topics.json >> output/cron.log 2>&1
```

---

## Layout

```
video-pipeline/
├─ src/
│  ├─ types.ts              # stage contracts (swap surface)
│  ├─ config.ts             # provider selection from env
│  ├─ pipeline.ts           # orchestrator
│  ├─ index.ts              # CLI
│  ├─ stages/
│  │  ├─ script/            # openai.ts, anthropic.ts
│  │  ├─ tts/               # openai.ts, elevenlabs.ts
│  │  ├─ visuals/           # pexels.ts
│  │  ├─ captions/          # whisper.ts
│  │  ├─ assembly/          # ffmpeg.ts
│  │  └─ publish/           # youtube.ts, instagram.ts, tiktok.ts
│  └─ util/                 # http, proc (ffmpeg), env, logger
├─ workflows/n8n-schedule.json
├─ topics.example.json
└─ .env.example
```
