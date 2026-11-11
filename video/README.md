# The Blink demo film

[`blink-film.mp4`](blink-film.mp4) is a 1:34 film at 1080p, 60 fps. Everything that made it is in `film/`. It is a separate project with its own dependencies; the app does not build, lint or deploy it.

## Get started

```bash
cd video/film
npm ci
npx remotion studio src/index.ts      # scrub the film in a browser
```

Render and add the sound:

```bash
mkdir -p out
npx remotion render src/index.ts Film out/film-silent.mp4 --muted --crf=14 --x264-preset=medium --jpeg-quality=95
ffmpeg -y -i out/film-silent.mp4 -i master.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -shortest -movflags +faststart out/blink-film-master.mp4
ffmpeg -y -i out/blink-film-master.mp4 -c:v libx264 -preset slow -crf 22 -pix_fmt yuv420p -c:a copy -movflags +faststart ../blink-film.mp4
```

The full-quality master is about 200 MB, over GitHub's 100 MB file limit, so it is not committed. The commands above rebuild it. You need `ffmpeg` on your PATH.

## What is where

| Path | What it is |
|---|---|
| `film/narration.json` | The script, one entry per spoken line |
| `film/src/narration.json` | The same lines with durations and word timings, written by `tts.mjs` |
| `film/timeline.mjs` | Works out when each line and scene happens. Writes `src/timeline.json` |
| `film/src/Film.tsx` | Every scene: copy, layout and camera moves |
| `film/src/kit.tsx` | Colours, the eyelid transition, the dither, the product window and its camera |
| `film/audio.mjs` | The score and sound effects, generated in code. Writes `music.wav` and `vo.wav` |
| `film/master.sh` | Mixes voice and music and sets the loudness. Writes `master.wav` |
| `film/capture.mts` | Takes the product screenshots into `public/shots/` and records zoom targets in `src-rects.json` |
| `film/preview.mjs` | Renders stills into one contact sheet: `node preview.mjs sheet.png 5 20 40` |
| `film/public/` | Screenshots, voice lines and the grain texture |

## Common changes

Every visual and sound is timed from the voice, so after changing narration run the steps in this order.

- **Change a line or the voice:** edit `narration.json`, then `node tts.mjs [voice]` (default `aura-2-athena-en`). This needs `DEEPGRAM_API_KEY` in the repo's `.env.local` and costs a few cents. It regenerates every line and prints `DIFF` for any word speech-to-text heard differently. `fix.mjs` retries individual lines; two takes (`l4`, `l6`) needed it. Then run the next two items.
- **Change timing:** edit `timeline.mjs`, then `node timeline.mjs`.
- **Change the music or effects:** edit `audio.mjs`, then `node audio.mjs && ./master.sh`. Rerun this after any timing change too.
- **Change text or visuals only:** edit `src/Film.tsx` and render.

## Retaking the screenshots

The screens were captured before later UI commits, so they may not match the current app. To retake them, start a clean app on port 3283 from the repo root:

```bash
export BLINK_DB_PATH=./data/video/C.db BLINK_LLM_MODE=replay BLINK_AUTH_MODE=switcher BLINK_ALLOW_SWITCHER=1
rm -f data/video/C.db*; mkdir -p data/video
pnpm exec drizzle-kit migrate && pnpm exec tsx scripts/seed.ts && pnpm exec tsx scripts/eval.ts --quiet
pnpm build && pnpm exec concurrently -k -n web,worker "next start -p 3283" "tsx scripts/worker.ts"
```

Then, in another terminal at the repo root, run `pnpm exec tsx video/film/capture.mts`. It also signs in to the deployed app for the two call screens, using `BLINK_SEED_PASSWORDS` from `.env.local`.

## Keep it honest

- The hook, call window, pill and after-call transcript are motion graphics rebuilt for the film. The end card says so.
- Product screens use synthetic data with saved model answers; the "Replay mode" label is hidden in the captures. The two call screens are a real test call on the deployed app.
- In real test calls the live warning often timed out, so the script says "if a warning doesn't land in time, nothing is lost". Don't promise that every warning arrives live.

Remotion is free for individuals and companies of up to 3 people. A larger company needs a [license](https://www.remotion.dev/license).
