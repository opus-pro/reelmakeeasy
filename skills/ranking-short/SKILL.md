---
name: ranking-short
description: Build a ranking short (a "Ranking the funniest ..." reel) in ReelMakeEasy's Ranking Builder from the user's clips. Use when the user asks for a ranking video, a top-5 or top-N short, a "ranking the funniest/craziest ..." reel, or to turn a folder of funny clips into one ranked short.
---

# Ranking shorts

A ranking short is a 9:16 reel with a title band at the top ("Ranking **Funniest** / **Cat Fails** Ever", keywords in colour), ranks 1 to N down the left, and one clip per rank playing behind them. Each rank's label ("Got bitten 😳") is revealed while its clip plays and stays on screen, so by the end the whole list is filled in. They are quick to make and do well when the clips are funny, the labels are short and the reveal keeps viewers guessing.

ReelMakeEasy's **Ranking Builder** (http://localhost:3000/ranking) is the studio for them: a live 9:16 preview, the title editor, ranks with clips and trims, meme sounds on each action, stickers, the reveal order, and Export, which renders a 1080×1920 MP4. You can build and export a project entirely through its API; the user can fine-tune it in the studio.

Inside ReelMakeEasy's own agent mode, use the `ranking_*` tools and the `reelmakeeasy-ranking` skill instead: this one is for an agent working from outside the app.

## What makes a good one

- **5 or 6 ranks, 3 to 5 seconds each.** It's a Short: fewer ranks feels thin, longer ranks drag. About 20 to 30 seconds in all, never over a minute.
- **A meme sound on every action** (the fall, the bite, the surprise), from the user's sound library (`GET /sounds`). Sound is half the joke. Never invent a sound id; when nothing fits, tell the user to add one in Ranking Builder > Sound library.
- **Stickers, sparingly:** an emoji or a short word (`NO WAY`, `💀`) near the action while that rank plays; one or two in the whole short.
- **The title is 2 lines, 2 to 4 words each, with the keywords in colour.** The topic and the angle stand out: `Ranking` (white) `Funniest` (red) / `Cat Fails` (cyan) `Ever` (white). Colour at most two phrases, and never the same colour twice in a row. Colours the studio offers: white `#ffffff`, red `#ff2a2a`, cyan `#22e5ff`, yellow `#ffd400`, green `#3dff6e`, pink `#ff5fd2`.
- **Labels are 1 to 4 words and an emoji** saying what happens or the reaction: `Got bitten 😳`, `Pure chaos 💀`, `Didn't see that coming 😂`. No full sentences, no rank numbers (the studio draws them).
- **Rank by how funny the moment is, not by length or quality.** #1 is the one that makes people replay.
- **Trim to the moment.** Each clip starts just before the funny beat and ends right after the payoff: no slow lead-ins. Watch or scan the clip to find it (see "Finding the moment").
- **Reveal order:** `shuffle` ("blind": the viewer doesn't know which rank fills next; #1 always comes last) keeps people watching best. `countdown` (N to 1) is the classic. `countup` gives away the best first: avoid it unless asked.
- **Only clips the user owns or may use.** Ask where the clips come from when it isn't clear; don't download other people's videos.

## The API

The app's API runs on this computer at http://localhost:5017/api (or `PORT` from `.env`). Saved projects hold `store://` addresses; the API sends URLs back.

| Step | Call |
| --- | --- |
| New project | `POST /ranking/projects` `{ "name": "Cat fails" }` → the project (5 empty ranks, each with an `id`) |
| Read it | `GET /ranking/projects/:id` |
| Upload a clip, 1 | `POST /media/generate-temp-upload-url` `{ "contentType": "video/mp4", "fileName": "cat1.mp4", "scope": "ranking" }` → `signedUrl`, `fileUri` |
| Upload a clip, 2 | `PUT <signedUrl>` with the file as the body (`Content-Type: video/mp4`) |
| Put it under a rank | `POST /ranking/projects/:id/items/:itemId/clip` `{ "fileUri": "<fileUri>", "name": "cat1.mp4" }` → the project; the clip plays its first 4.5 s until trimmed |
| The user's sounds | `GET /sounds` → `[{ "id", "name", "durationSec", "favorite", "uses" }]`, starred and most used first |
| A picture sticker | upload it as above (`"scope": "ranking"`, an image type), then `POST /ranking/projects/:id/sticker-images` `{ "fileUri", "name": "logo.png" }` → `{ "imageUrl" }` |
| Title, labels, trims, sounds, stickers, order | `PUT /ranking/projects/:id` with any of `name`, `title`, `items`, `reveal`, `sounds`, `stickers`, `transition`, `style` |
| Export | `POST /ranking/projects/:id/export` → `{ "renderId", "state", "progress" }`; poll `GET /ranking/renders/:renderId` until `state` is `done` (`videoUrl`) or `failed` (`error`). About a minute. |

`PUT` takes whole fields: send `items` with every rank, in rank order (position 0 is rank 1), each with its `id`, `label` and `clip` (the clip object as the project returned it, with your `trimStartSec` and `trimEndSec`; `null` for none). To add or remove ranks, send the longer or shorter list (2 to 10 ranks; give a new rank a new short `id` such as `r6`). The `reveal` is `{ "mode": "shuffle" | "countdown" | "countup" | "custom", "order": [ranks in reveal order] }`; for `custom` the order must hold every rank once. Colours are `#rrggbb`.

- **Sounds on the action:** each item takes `cues`, up to 8 `{ "id", "soundId", "atSec" }`, with `atSec` in seconds from where the clip starts playing (after its trim) and inside its play time.
- **`sounds`:** `{ "reveal": soundId | null, "music": soundId | null, "musicVolume": 0-1 }`: a sound on every clip start, and a background bed.
- **`stickers`:** up to 20 `{ "id", "kind": "text" | "image", "text"?, "imageUrl"?, "color", "x": 0-1, "y": 0-1, "size", "rotation": degrees, "rank": a rank or null (the whole short) }`. For text, `size` is its height as a share of the frame (0.04-0.12); for a picture, its width (0.1-1). Keep them in the clip area (y 0.25-0.9), clear of the ranks on the left (x 0.55-0.9 is usually free).
- **`transition`:** `{ "enabled", "text": "Number {rank}…", "background", "textColor", "durationSec": 0.5-3, "sound": soundId | null }`: a slide between ranks, off by default.

```bash
API=http://localhost:5017/api
# 1. A project.
P=$(curl -s -X POST $API/ranking/projects -H 'content-type: application/json' -d '{"name":"Funniest cat fails"}')
ID=$(echo "$P" | jq -r .id)
# 2. A clip under rank 1.
ITEM=$(echo "$P" | jq -r '.items[0].id')
UP=$(curl -s -X POST $API/media/generate-temp-upload-url -H 'content-type: application/json' \
  -d '{"contentType":"video/mp4","fileName":"cat1.mp4","scope":"ranking"}')
curl -s -X PUT -H 'content-type: video/mp4' --data-binary @cat1.mp4 "$(echo "$UP" | jq -r '.data.signedUrl // .signedUrl')"
curl -s -X POST $API/ranking/projects/$ID/items/$ITEM/clip -H 'content-type: application/json' \
  -d "{\"fileUri\":\"$(echo "$UP" | jq -r '.data.fileUri // .fileUri')\",\"name\":\"cat1.mp4\"}"
```

## How to work

1. **Ask** what the ranking is about and where the clips are (a folder on this computer is easiest). Look at what's there: how many clips, how long, what happens in each.
2. **Pick the ranks.** Choose the 5 or 6 funniest moments, rank them, and write a label for each. Show the user the list (rank, clip, label) and the title in a few lines, and ask before building.
3. **Build** the project through the API: create it, upload each clip under its rank, read the sound library, then one `PUT` with the title, the labels, the trims (3 to 5 s), the cues, any stickers and `reveal` (`shuffle` unless the user wants another order).
4. **Export** with `POST /ranking/projects/:id/export` and wait for it. The app renders it in a headless browser, so the title and labels get the real font and colour emoji.
5. **Hand it over:** the video link, and the studio link `http://localhost:3000/ranking?id=<id>` for fine-tuning (a trim, a sound and its moment, a label, a sticker).

## Finding the moment

When you can't watch a clip, these find the likely funny beat:

```bash
# Its length.
ffprobe -v error -show_entries format=duration -of csv=p=0 clip.mp4
# The loudest half-seconds (a scream, a crash, laughter): the RMS level every 0.5 s.
ffmpeg -i clip.mp4 -af "asetnsamples=24000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level" -f null - 2>&1 | grep -o "RMS_level=[-0-9.]*" | nl
# Big visual changes (a fall, a jump, a cut).
ffmpeg -i clip.mp4 -vf "select='gt(scene,0.3)',showinfo" -f null - 2>&1 | grep -o "pts_time:[0-9.]*"
```

Start the trim about 1 to 1.5 s before the loudest moment or the biggest change, and end it about 1 s after. Put the action's sound cue at that moment (its time minus the trim start).
