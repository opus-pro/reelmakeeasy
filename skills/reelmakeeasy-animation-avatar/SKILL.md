---
name: reelmakeeasy-animation-avatar
description: How to make a ReelMakeEasy Talking head (draw the user's digital avatar from their photo (2D or 3D, a rig of moving parts), save it, and build a video where it talks to the camera, waist up, with gestures and pictures). Use in every Talking head Claude Animation chat, before drawing or changing the avatar, writing the script, recording, building, rendering or changing it.
---

# Claude Animation: Talking head

A Claude Animation is a short vertical video (9:16) that you draw and animate yourself, every frame in code, as a Remotion project. No AI video or image model makes any of it: the voices come from the app, the pictures from your code. It looks good when it teaches one surprising, true thing clearly, and the picture moves with what is being said.

## The project

ReelMakeEasy sets the project up in `animation/`: before your first turn when the user filled in the setup card, or when you call `animation_setup` in an Advanced chat. You get:
- `animation/brief.md`: what the user asked for (what it is about, the look, the length, the music).
- `animation/look.md`: the look's card (what it looks like, its palette, its voices). Stay inside its palette.
- `animation/src/clock.ts` (the size, length and the voice lines' timing), `animation/src/kit.tsx` (`<Voice />`, `<Music />`, `<Captions />`, the mouth and easing hooks), the look's library, and `animation/src/Animation.tsx` (a starter you replace). ReelMakeEasy owns all but `Animation.tsx` and refreshes them: use them, never edit them; put your own components in `src/scenes/`.
- `animation/public/voice/lines.json` and `public/voice.wav` once you record the voices; `public/music.wav` when there is music.

Remotion is installed. Its own skills (`remotion-best-practices`, `remotion-markup`, `remotion-multimedia`) have its API in detail; where they differ, follow this skill (here ReelMakeEasy sets the project up, records the voices and renders).

## How to work

1. **Read** `brief.md`, `look.md` and the look's library (`index.ts`).
2. **Write the script** the look asks for (below), and a plan of one short line per scene (what is said, what is on screen), into `animation/plan.md` ("## Script" with "Who: words" rows, "## Plan" with "Scene N: …" lines): the Tasks panel beside the chat shows it. Write both in your reply too (the user sees neither your thinking nor the file in the chat), then ask with a card whether to build it ("Build it (Recommended)" or "Change something"), unless they already said to go ahead.
3. **Record the voices** with `animation_voice`: `lines` one "Who: words" per row, in order, and `voices` one "Who: description" per speaker. It keeps takes that say your words and match each speaker; listen to the lines it warns about (ask the user). When the total is much longer than the length asked for, shorten the script and record again.
4. **Make the music** only when the brief says you make it: composed by you (write `animation/music/music.mjs` with the `reelmakeeasy-music-composer` skill, run `cd animation/music && node tools/score.mjs --no-cues`, then `animation_music` with engine "composer"), or a music model through `animation_music` with a prompt. Keep it calm under the voice.
5. **Build.** One component per scene in `src/scenes/`, placed in `Animation.tsx` with `<Sequence from={lineStart(i)}>` so every scene starts on its line. Keep `<Voice />`, `<Music />` and `<Captions />` in `Animation.tsx` (captions in the look's palette and font).
6. **Look.** Call `animation_still` on the important moments (each scene's start and its key word) and look at the images. Fix what is cut off, too small, crowded, off-palette or off-look before rendering.
7. **Render** with `animation_render`: it shows the video to the user. You can't hear it: say so and ask the user to listen to the voices.
8. **Review.** Nothing is one-shot: after every render, call `animation_review` (contact sheets of the render, with where nothing moves and the scenes held too long), open every sheet, and write `animation/review.md`: every problem by time (a mouth that doesn't move, something under the bubble or captions, cut-off or tiny text, a label off its part, a picture that misses its word, a stall, an empty or crowded frame) with its fix. Fix them, render again and check that render: up to 3 rounds, then say what is still off.
9. **Change it** when the user asks: edit the scene (record again only when the words change), look at a still, render, check. Say what you changed in one line.

## Timing rules

- Time everything to the voice with `clock.ts`: `lineStart(i)`, `lineEnd(i)`, `wordAt(i, w)` (line i's word w), `sec(s)` for durations. Never type a frame number for a moment in the story: then the picture still fits when a line is recorded again.
- A picture change lands on the word it shows (the number appears on "500", the arrow on "flows").
- `useMouth(who)` gives a speaker's mouth (0..1) and vowel on every frame; `useSpeaking()` says who is talking.

## The Talking head: your avatar talks to the camera

A host, the user's own digital avatar, stands waist up in a simple set, looks into the camera and explains one thing, with gestures on its key words and pictures popping up beside or above it on the words they show. It is drawn in code like everything else: no AI picture or video model.

### First: the avatar

`brief.md` says whether the avatar is saved (use `src/avatar/avatar.ts` as it is; change it only when the user asks) or new (draw it from the photo in `animation/public/avatar/` first). A new one is the first thing you make, before the script:

1. **Study the photo** (open it). Write down what makes this person recognisable: face shape (round, long, square, heart), skin tone (pick the hex from the photo), hair (style, length, parting, fringe, curls, colour and its highlight), eyebrows (shape, thickness, colour), eyes (colour, size, spacing), glasses, facial hair, ears, freckles or dimples, age, and the clothes (garment, collar, colours, a pattern or logo shape). Don't flatter it into a generic face, and don't caricature it: it should read as them at a glance, as a friendly cartoon.
2. **Draw the rig** in `src/avatar/avatar.ts`: it starts as the starter of its style (a plain person in a blue jumper). Keep its structure and the pose it reads; change the colours, then the shapes: the face outline, the hair (a back layer behind the head and a front layer over the forehead, both moving with the head), the brows, the eyes, the nose, the clothes, glasses and beard. Keep the face's centre, shoulders and waist where the starter has them (the stage frames the shots from them).
3. **Check** with `avatar_check`: a sheet of 16 poses. Open it beside the photo and fix what is off (likeness first, then every mouth shape, the blink, each gesture's hand). Two or three rounds are normal.
4. **Ask** the user with a card whether to keep it ("Keep this avatar (Recommended)" or "Change something"), then **save** it with `avatar_save` and a voice that fits the person (`voice`: age, warmth, energy, pace). It goes into the user's avatars with a voice sample: every later video uses the same face and voice.

When the user asks to change a saved avatar (new glasses, a different shirt), change `avatar.ts`, check, and save again (the same avatar is updated; pass a new `voice` only to change the voice).

### The rig contract

`avatar.ts` exports `avatar`: a 2D one (`{ style: '2d', name, draw(p) }`, `draw` returning SVG for the avatar's own box: 1000 wide, origin at the waist (bottom centre), y up negative, the face's centre near y -900, shoulders near (±215, -560)) or a 3D one (`{ style: '3d', name, build(THREE) }` returning `{ root, pose(p) }`, metres, origin at the waist, facing +z, the head's centre near 0.72 m). Everything moves from the pose `p` alone:
- `p.mouth` (0 shut .. 1 wide) and `p.vowel` (`A E I O U M`): use `mouthShape(p.vowel)` for the width and height factors.
- `p.blink` (0 open .. 1 shut), `p.gaze` ([x, y], -1..1), `p.brows` (-1 frown .. 1 raised), `p.smile` (0..1).
- `p.head` (`nod`, `tilt`, `turn`, degrees): tilt the head about the neck, slide the features with turn and nod.
- `p.left`, `p.right` (screen sides): each `{ gesture, k, n, since }`. In 2D draw them with `drawArm(side, p.left, shoulder, { skin, sleeve, cuff })` after the head (raised hands go over the face); in 3D make them once with `makeArm3D(THREE, { side, skin, sleeve })` and call `.pose(p.left)`.
- `p.shrug` (0..1): lift the shoulders. The stage does the lean and the breathing.

### The video

- **Script:** one host, talking to the viewer as "you", about 2.4 words per second of length (72 words for 30 s). Line 1 is the hook ("Did you know…" with the surprising fact in everyday words); one idea per line; the last line closes the loop and ties it to daily life. Record it with voices "Host: avatar".
- **Shots:** one per line, `medium` (waist up, pictures above), `close` (the face: the hook and the big moments), `left` / `right` (the host to one side, pictures on the other) and `wide`. Change shot on most lines; start on `close` or `medium`.
- **Gestures** are cues on words: `{ at: word(i, 'three').start, gesture: 'count', n: 3, hand: 'right' }`. Gestures: `open` (both hands, presenting), `point` (toward the board side), `count` (n fingers), `thumb`, `wave` (hello and goodbye), `think`, `shrug`. One every line or two, on the word it means; `hold` sets how long (1.4 s by default). Also `{ at, look: 'right' }` (the eyes and head go to the board, then `'camera'` back), `{ at, mood: 'surprised' | 'serious' | 'smile' }`, `{ at, nod: true }`, `{ at, lean: 4 }`. The voice already drives the mouth, the blinks and small head moves.
- **The board:** `board(t, i, area)` draws the pictures for line i as SVG in screen pixels inside `area` (the shot's free space, above or beside the host): a number that counts up, an icon, a simple diagram, a labelled chip, each popping in on its word (`back(ss(w.start - 0.2, w.start + 0.2, t))`). Big and bold: at least 3% of the frame height for text.
- **The set:** behind the host, simple and in the palette: a soft gradient wall with a shape or two that drift (2D: `set(t, i, shot)` returns SVG for the screen; 3D: `set(E)` builds walls, a desk or shelves and lights once in `E.scene`, the host stands at the origin). Keep it calm; the host and the board carry the video.
- **Captions** under the host with `<Captions />` (they sit in the lower third, over the torso).

### The host kit (`src/host/`)

`Animation.tsx` holds `<Voice />`, `<Music />`, `<TalkingHead2D avatar={avatar} shots={shots} cues={cues} set={set} board={board} />` (or `<TalkingHead3D … />` for a 3D avatar) and `<Captions />` after it. Import `avatar` from `./avatar/avatar` and timing helpers from `./toon` (`L`, `word`, `ss`, `back`, `lerp`, `chip`): they work for both styles.

A minimal `src/scenes/talk.ts`:

```ts
import type { Area, Cue, Shot } from '../host'
import { back, chip, ss, word } from '../toon'

export const shots: Shot[] = ['close', 'right', 'medium', 'left', 'close']
export const cues: Cue[] = [
  { at: word(0, 'know').start, gesture: 'open', hand: 'both' },
  { at: word(1, 'three').start, gesture: 'count', n: 3 },
  { at: word(3, 'look').start, look: 'right' },
  { at: word(4, 'bye').start, gesture: 'wave' },
]
export const set = () => `<rect width="1080" height="1920" fill="#1B1F2A"/><circle cx="860" cy="420" r="260" fill="#24304A"/>`
export function board(t: number, i: number, a: Area) {
  if (i !== 1) return ''
  const w = word(1, 'three')
  return chip(a.x + a.w / 2, a.y + 200, '3 TIMES', { size: 64, k: back(ss(w.start - 0.2, w.start + 0.2, t)) })
}
```

## Sound and music

A video with only a voice feels flat. Sound effects and a picture that moves with the music are what make it feel alive.

**Sound effects.** `<Sfx name="pop" at={word(2, 'three').start} />` from `src/kit.tsx` plays one at a moment in seconds (or list them as `SoundCue`s and put `<Sounds cues={SOUNDS} />` in `Animation.tsx`). `volume` 0..1: about 0.3 while someone speaks, 0.5-0.7 between lines; the voice always stays on top.
- Every entrance gets its sound on its frame: an icon or picture popping in (`pop`, `bubble`), a panel or text sliding in (`swish`, `whoosh` for big moves), a headline typing in (`typing`), a counter or number (`tick` per step, `coin` when it lands), a photo (`shutter`), a fact landing or a right answer (`ding`, `chime`), something growing or flying up (`slide-up`), dropping or shrinking (`slide-down`), a bounce or surprise (`boing`), magic or stars (`twinkle`, `shimmer`), the big reveal or the end card (`tada`, `riser` leading into it).
- About one every 1-2 seconds, none within 0.15 s of another, and varied: the same sound on every entrance becomes noise.
- The host's gestures already make their own small sound (a `boop` on a wave, a `ding` on a thumbs up, a `bubble` per finger counted, a `zip` on a point, a `swish` on open hands, a `boing` on a shrug or surprise): don't add another on the same moment. `sounds={false}` on the stage turns them off; `sounds={{ ...DEFAULT_GESTURE_SOUNDS, wave: 'chime' }}` changes one.
- The pack (`public/sfx/`):
  - `whoosh`: an air whoosh (transitions, big moves across the frame)
  - `swish`: a fast light swish (small moves, text sliding in)
  - `riser`: a 2-second build that ends on its frame (place it to end on the drop; the file starts 2 s earlier)
  - `tick`: a crisp tick (counters, timecode, precise cuts)
  - `click`: a dry UI click (buttons, toggles, a cursor press)
  - `pop`: a bubbly pitch-drop pop (shapes, icons or cards appearing)
  - `hit`: a punchy low impact with a crack (big title slams, the drop)
  - `sub-drop`: a deep falling boom (scene drops, dark reveals)
  - `glitch`: a short digital stutter (glitch cuts, data, tech reveals)
  - `shimmer`: a bright sparkle tail (logo reveals, end cards)
  - `boing`: a springy cartoon boing (a bounce, a surprise, a shrug, something landing)
  - `boop`: a soft round boop (a wave, a tap, a small friendly accent)
  - `bubble`: a quick rising blip (a bubble, an icon popping up from below)
  - `chime`: a two-note chime (a new section, a notification, "here is the answer")
  - `coin`: a bright two-note coin (a number, a reward, money, a score going up)
  - `ding`: a clear little bell (a thumbs up, a right answer, a fact landing)
  - `shutter`: a camera shutter (a photo or a picture appearing)
  - `slide-down`: a slide whistle falling (something dropping, getting smaller, a fail)
  - `slide-up`: a slide whistle rising (something growing, flying up, a reveal)
  - `tada`: a bright four-note arpeggio (the big reveal, the end card)
  - `twinkle`: a sparkle of rising bell notes (magic, stars, something appearing with a glow)
  - `typing`: a short burst of key taps (text typing in, a headline being written)
  - `zip`: a fast zip (a pointer, an arrow, a line drawing across)

**Move with the music.** `src/beat.ts` has the music's grid (`music.bpm`, `beats`, `downbeats`, `kicks`, `snares`, `accents`, `sections`, in seconds; empty with no music). `beatPulse(t, 'beats')` is 1 on each beat easing to 0: give what is already on screen a small life on the beat (a background shape breathing 2-4%, a glow, a bounce of an icon, the ticker's dot). Land entrances that aren't tied to a word on the music with `onBeat(t)`, the bigger changes (a new panel, a scene's set) on a downbeat (`nextBeat(t, 'downbeats')`) or a section start (`sectionAt(t)`). Keep it light: one or two things pulse, never the whole frame on every beat. The host already nods on the beats and sways with the bars.

## Craft rules

- **Hook first, in everyday words.** The first line is the surprising fact ("Did you know…"), not an introduction.
- **True facts.** You have no web here: state only what you are sure of, hedge where the science hedges ("about", "could"), and write numbers as digits ("3000 years") so the voice check matches.
- **Never still.** Something moves on every frame: a drift, a breath, a blink, a camera move.
- Keep text and key shapes inside a 6% safe margin; the smallest text is at least 3% of the frame height. Measure long text with `measureText`/`fitText` from `@remotion/layout-utils`.
- Ease every move (`ease.snap`, `ease.glide`, `usePopAt`); nothing moves linearly except constant drifts. Keep it deterministic: no `Math.random()` (use `random(seed)` from Remotion), no CSS transitions.
- Fonts come from `@remotion/google-fonts`. Images only from `animation/public/`.
- English only.
- Type-check with `npx tsc --noEmit` inside `animation/` when you change several files.
- Never run `remotion render`, `remotion still` or `npm install` yourself: `animation_still` and `animation_render` render for you, `animation_voice` records, and everything you need is installed.
