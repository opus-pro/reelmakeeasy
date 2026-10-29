---
name: reelmakeeasy-animation-avatar
description: How to make a ReelMakeEasy Avatar explainer (draw the user's digital avatar from their photo (2D or 3D, a rig of moving parts), save it, and build a video where it talks to the camera, waist up, with gestures and pictures, in 2D, 3D or Pixel art). Use in every Avatar explainer Claude Animation chat, before drawing or changing the avatar, writing the script, recording, building, rendering or changing it.
---

# Claude Animation: Avatar explainer

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
5. **Build.** One component per scene in `src/scenes/`, placed in `Animation.tsx` with `<Sequence from={lineStart(i)}>` so every scene starts on its line. Keep `<Voice />`, `<Music />` and `<Captions />` in `Animation.tsx` (captions in the look's palette and font). `<Captions />` pages a phrase at a time as the app's captions do (1-3 words, a phrase ending after punctuation, the spoken word lit): use it as it is, move it with `bottom` (a share of the height) and add `box` over a face or a busy picture; never write captions of your own that slide a word at a time.
6. **Look.** Call `animation_still` on the important moments (each scene's start and its key word) and look at the images. Fix what is cut off, too small, crowded, off-palette or off-look before rendering.
7. **Render** with `animation_render`: it shows the video to the user. You can't hear it: say so and ask the user to listen to the voices.
8. **Review.** Nothing is one-shot: after every render, call `animation_review` (contact sheets of the render, with where nothing moves and the scenes held too long), open every sheet, and write `animation/review.md`: every problem by time (a mouth that doesn't move, something under the bubble or captions, cut-off or tiny text, a label off its part, a picture that misses its word, a stall, an empty or crowded frame) with its fix. Fix them, render again and check that render: up to 3 rounds, then say what is still off.
9. **Change it** when the user asks: edit the scene (record again only when the words change), look at a still, render, check. Say what you changed in one line.

## Timing rules

- Time everything to the voice with `clock.ts`: `lineStart(i)`, `lineEnd(i)`, `wordAt(i, w)` (line i's word w), `sec(s)` for durations. Never type a frame number for a moment in the story: then the picture still fits when a line is recorded again.
- A picture change lands on the word it shows (the number appears on "500", the arrow on "flows").
- `useMouth(who)` gives a speaker's mouth (0..1) and vowel on every frame; `useSpeaking()` says who is talking.

## The Avatar explainer: your avatar talks to the camera

A host, the user's own digital avatar, stands waist up in a simple set, looks into the camera and explains one thing, with gestures on its key words and pictures popping up beside or above it on the words they show. It is drawn in code like everything else: no AI picture or video model.

### First: the avatar

`brief.md` says whether the avatar is saved (use `src/avatar/avatar.ts` as it is; change it only when the user asks) or new (draw it from the photo in `animation/public/avatar/` first). A new one is the first thing you make, before the script:

1. **Study the photo** (open it). Write down what makes this person recognisable: face shape (round, long, square, heart), skin tone (pick the hex from the photo), hair (style, length, parting, fringe, curls, colour and its highlight), eyebrows (shape, thickness, colour), eyes (colour, size, spacing), glasses, facial hair, ears, freckles or dimples, age, and the clothes (garment, collar, colours, a pattern or logo shape). Don't flatter it into a generic face, and don't caricature it: it should read as them at a glance, as a friendly cartoon.
2. **Draw the rig** in `src/avatar/avatar.ts`: it starts as the starter of its style (a plain person in a blue jumper). Keep its structure and the pose it reads; change the colours, then the shapes: the face outline, the hair (a back layer behind the head and a front layer over the forehead, both moving with the head), the brows, the eyes, the nose, the clothes, glasses and beard. Keep the face's centre, shoulders and waist where the starter has them (the stage frames the shots from them).
3. **Check** with `avatar_check`: a sheet of 16 poses. Open it beside the photo and fix what is off (likeness first, then every mouth shape, the blink, each gesture's hand). Two or three rounds are normal.
4. **Ask** the user with a card whether to keep it ("Keep this avatar (Recommended)" or "Change something"), then **save** it with `avatar_save` and its fixed voice: `voiceId`, the free voice from the tool's list that best fits the person (age, gender, energy), or one the user named. It goes into the user's avatars: every later video uses the same face and the same voice, and the user can change the voice on the setup card.

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
- **Shots:** one per line, `medium` (waist up, pictures above), `close` (the face: the hook and the big moments), `left` / `right` (the host to one side, pictures on the other), `wide`, and `corner` / `corner-left` (the host small in a bottom corner, the frame left for big cards and a headline: the editorial explainer). Change shot on most lines; start on `close` or `medium`.
- **Keep it moving (2D):** a host that stands still in one spot makes a dull video. The host **walks** to each new shot's spot instead of jumping (two steps, leaning into it), and a `{ at, move: 'right' }` cue walks it somewhere mid-line (to the front with `close`, across under a card from `corner` to `corner-left`). Each line can also **change the scene** on its way in, with `transitions` (one per line, `<TalkingHead2D transitions={transitions} />`): `move` (the default: the set stays, the host walks), `cut`, and seven scene changes, each for its moment:
  - `slide`: the camera slides on to the next stop, set and board as one strip, against the host's walk. Steps, lists, "next".
  - `flip`: the board turns over like a card, the host in front. The other side of a story: myth then fact, before then after, problem then fix.
  - `drop`: the next page falls in from the top and lands with a bounce. A new chapter, a document or card to read, a result landing.
  - `blinds`: diagonal stripes sweep across into the new scene. A quick change of topic or a list that speeds up; lively, graphic.
  - `whip`: the whole frame, host and all, whips off with motion blur. A turn, a surprise, "but", "no…".
  - `zoom`: flying through into the next scene. Going deeper, inside something, "how it works".
  - `iris`: the new scene opens as a circle from the host's face. The first step after the hook, a big reveal, the ending.
  Vary them: never the same scene change twice in a row, three or four kinds in a video; a section change gets a scene change, a point inside a section a walk. Give each section its own set (`set(t, i, shot)`: another tint, a big faint number or icon, other props) so a slide reads as arriving somewhere new, and never slide the pictures off yourself: the transition takes the old scene away. Each transition and walk has its own sound (a whoosh, a swish, a twinkle).
- **Gestures** are cues on words: `{ at: word(i, 'three').start, gesture: 'count', n: 3, hand: 'right' }`. Gestures: `open` (both hands, presenting), `point` (toward the board side, or **at something**: `{ at, gesture: 'point', target: [x, y] }` aims the arm and the eyes at that spot on screen (1080×1920), with the hand on its side; make the thing pointed at react with `pointedAt(cues, t, [x, y])`, 0..1: grow it 10-15%, wiggle it, light it up), `count` (n fingers), `thumb`, `wave` (hello and goodbye), `think`, `shrug`. One every line or two, on the word it means; `hold` sets how long (1.4 s by default). Also `{ at, look: 'right' }` (the eyes and head go to the board, then `'camera'` back), `{ at, mood: 'surprised' | 'serious' | 'smile' }`, `{ at, nod: true }`, `{ at, lean: 4 }`. The voice already drives the mouth, the blinks and small head moves.
- **The board:** `board(t, i, area)` draws the pictures for line i as SVG in screen pixels inside `area` (the shot's free space, above or beside the host): a number that counts up, an icon, a simple diagram, a labelled chip, each popping in on its word (`back(ss(w.start - 0.2, w.start + 0.2, t))`). Big and bold: at least 3% of the frame height for text.
- **The set:** behind the host, simple and in the palette: a soft gradient wall with a shape or two that drift (2D: `set(t, i, shot)` returns SVG for the screen; 3D: `set(E)` builds walls, a desk or shelves and lights once in `E.scene`, the host stands at the origin). Keep it calm; the host and the board carry the video.
- **Captions** under the host with `<Captions />` (they sit in the lower third, over the torso).

### The host kit (`src/host/`)

`Animation.tsx` holds `<Voice />`, `<Music />`, `<TalkingHead2D avatar={avatar} shots={shots} cues={cues} set={set} board={board} transitions={transitions} />` (or `<TalkingHead3D … />` for a 3D avatar) and `<Captions />` after it. Import `avatar` from `./avatar/avatar` and timing helpers from `./toon` (`L`, `word`, `ss`, `back`, `lerp`, `chip`): they work for both styles.

A minimal `src/scenes/talk.ts`:

```ts
import { type Area, type Cue, type Shot, type Transition } from '../host'
import { back, chip, ss, word } from '../toon'

export const shots: Shot[] = ['close', 'right', 'medium', 'left', 'close']
export const transitions: Transition[] = ['cut', 'iris', 'slide', 'whip', 'move']
export const cues: Cue[] = [
  { at: word(0, 'know').start, gesture: 'open', hand: 'both' },
  { at: word(1, 'three').start, gesture: 'count', n: 3 },
  { at: word(2, 'here').start, gesture: 'point', target: [540, 520] },
  { at: word(3, 'look').start, move: 'right' },
  { at: word(4, 'bye').start, gesture: 'wave' },
]
const WALLS = ['#1B1F2A', '#22324A', '#2E2240', '#1F3A33', '#1B1F2A']
export const set = (t: number, i: number) => `<rect width="1080" height="1920" fill="${WALLS[i]}"/><circle cx="860" cy="420" r="260" fill="#ffffff10"/>`
export function board(t: number, i: number, a: Area) {
  if (i !== 1) return ''
  const w = word(1, 'three')
  return chip(a.x + a.w / 2, a.y + 200, '3 TIMES', { size: 64, k: back(ss(w.start - 0.2, w.start + 0.2, t)) })
}
```

### In Pixel art

When `look.md` says "in Pixel art", the host stands in a pixel world. Read the `reelmakeeasy-animation-8bit` skill for the world (the engine `E`, its helpers, the HUD and its layout) and build the world as it says, in `src/scenes/world.ts`. `Animation.tsx` then holds `<Voice />`, `<Music />` and `<PixelTalkingHead avatar={avatar} build={world} cues={cues} res={…} />` from `./pixel-host` (the pixel grid from the Detail in `brief.md`), and no `<Captions />`: call `narration(H, t)` at the end of the world's update, as the 8-bit skill does.

- **A 3D avatar** stands in the scene: `build(E, host)` gets `host.root` (the waist at the origin, facing +z, the head about 0.72 m up). Stand it on your world's ground (`host.root.position`), face it to the camera, light it with the world's lights, and frame each line with `E.camera` (a close shot about 1.3 m from the head, a medium one about 3 m, a wide one that shows the world around it). It is drawn, dithered and lit with everything else.
- **A 2D avatar** is drawn over the world, cut to the same pixel grid: `place={(t) => ({ x, y, s })}` puts its waist at (x, y) on the 1080×1920 screen, scaled (0.92 waist up at the bottom centre, 1.45 a close-up, 0.5 small in a corner). Move it between spots by easing x, y and s over a line's start. `build(E, null)` builds the world alone.
- The script, cues and gestures are as above (the voice drives the mouth; `cues` the gestures, looks and moods). There is no board: put the pictures, labels and counters in the world and on the HUD (`H`), beside the host, on the words they show. `PixelSprite` from `./pixel-host` cuts any other SVG to the same grid.

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
