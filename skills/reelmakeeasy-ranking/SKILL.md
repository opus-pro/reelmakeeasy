---
name: reelmakeeasy-ranking
description: How to build a ranking short (a Ranking the funniest ... reel) in ReelMakeEasy with the ranking_* tools. Use whenever the user wants a ranking video, a top-5 of clips, or to change, add sound to or export one.
---

# Ranking shorts

A ranking short is a 9:16 Short: a title band at the top with its keywords in colour, ranks 1 to N down the left, and one clip per rank playing under them. As each clip plays its label appears next to its number and stays. What makes them work: funny clips that fit the title, very short ranks, and a meme sound on every action.

## The format

- **3-5 s per rank.** A Short moves fast: trim every clip to its moment, starting just before the action and ending just after the payoff. New clips play 4.5 s until trimmed. 5 or 6 ranks, about 20-30 s in all; never over a minute.
- **Title:** two lines, `Ranking` + an angle word (`Best`, `Funniest`, `Craziest`) on the first, the topic + `Moments`, `Trend` or `Fails` on the second. Colour the angle word and the topic, nothing else.
  Colours: #ffffff, #ff2a2a, #22e5ff, #ffd400, #3dff6e, #ff5fd2 (white, red, cyan, yellow, green, pink). The usual look: `Ranking` white, the angle word red, the topic cyan, the last word white.
- **Labels:** 1-4 words and one emoji, what happens or the reaction (`Got bitten 😳`, `Pure chaos 💀`). No sentences, no rank numbers.
- **Order:** rank by how funny or impressive the moment is; #1 makes people replay. Reveal `shuffle` (blind: the viewer never knows which rank fills next; #1 always last) or `countdown`.
- **Sound is half the joke.** Every rank gets at least one meme sound **on the action** (the fall, the bite, the surprise), from the user's sound library. A reveal sound on every clip start is optional; a short background bed under it all is optional.
- **Stickers** add punch on the big moments: an emoji or a short word (`NO WAY`, `💀`) near the action, only while that rank plays. Use them sparingly: one or two in the whole short.

## The tools

- `ranking_list`: the user's rankings and their **sound library** (ids, names, lengths; starred and most used first). Read it before choosing sounds: use only these ids.
- `ranking_create` → a project with 5 empty ranks. `ranking_get` reads one back, with what still stops its export and tips.
- `ranking_add_clip`: a video file from your working folder under a rank (the user's attachments are in `attachments/`).
- `ranking_add_sticker_image`: a picture from your working folder (png, jpg, webp, gif) for an image sticker; answers its `imageUrl`.
- `ranking_update`: `patch` is a JSON object of whole fields to replace (send each field in full, as `ranking_get` shows it).
- `ranking_export`: renders the MP4 (about a minute) once every rank has a clip and a label.

## The fields

- `title`: `{ "band": "#000000", "lines": [[{ "text": "Ranking", "color": "#ffffff" }, { "text": "Funniest", "color": "#ff2a2a" }], [...]] }` (1-3 lines).
- `items`: every rank, top first: `{ "id", "rank", "label", "clip", "cues" }`. Keep each `id` and `clip` as `ranking_get` shows them; change `clip.trimStartSec` / `clip.trimEndSec` to trim. Reorder ranks by reordering the array (ranks renumber 1..N).
- `cues` on an item: up to 8 `{ "id", "soundId", "atSec" }`, `atSec` in seconds from where the clip starts playing (after its trim), within its play time.
- `reveal`: `{ "mode": "shuffle" | "countdown" | "countup" | "custom", "order": [ranks in play order] }`.
- `sounds`: `{ "reveal": soundId | null, "music": soundId | null, "musicVolume": 0-1 }`.
- `stickers`: up to 20 `{ "id", "kind": "text", "text": "💀", "color": "#ffffff", "x": 0-1, "y": 0-1, "size": 0.04-0.12 (text height / frame height), "rotation": degrees, "rank": a rank or null (the whole short) }`. Keep them in the clip area (y 0.25-0.9) and clear of the rank list on the left (x 0.55-0.9 is usually free). A picture: `"kind": "image", "imageUrl"` from `ranking_add_sticker_image`, `size` its width as a share of the frame (0.1-1).
- `transition`: `{ "enabled", "text": "Number {rank}…", "background", "textColor", "durationSec": 0.5-3, "sound": soundId | null }`: a slide between ranks. Off by default; Shorts usually go straight cut to cut.

## How to work

1. Ask what the ranking is about and where the clips are (attachments in the chat). Look at each clip: what happens and when (`ffprobe` for its length; `ffmpeg` to pull a frame or find the loudest moment).
2. Pick the ranks, write the title and labels, and choose a sound for each action from the library. Show the user the plan in a few lines (rank, clip, label, sound and its moment) and ask before building.
3. Build: `ranking_create`, `ranking_add_clip` for each rank, then one `ranking_update` with the title, items (labels, trims to 3-5 s, cues), reveal, sounds and any stickers.
4. `ranking_export`, then tell the user it's ready and that they can fine-tune it in the studio (Ranking Builder). Say what you can change: a trim, a sound and its moment, a label.

When the library has no sound that fits, say so and suggest the user add one in Ranking Builder > Sound library. Never invent sound ids.
