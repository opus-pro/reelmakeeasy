---
name: reelmakeeasy-animation-2d
description: How to write and build a ReelMakeEasy Claude Animation in the 2D look (two cartoon characters with faces chatting, lip-synced, drawn in code in Remotion). Use in every 2D Claude Animation chat, before writing the script, recording voices, building scenes, rendering or changing it.
---

# Claude Animation: 2D

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

## The 2D look: two characters talk

Two cartoon characters with faces (objects, food, animals, people, the Moon) chat about one fun fact. One is curious, one knows; they take turns.

- **Script:** six lines, about 60-70 words in all for 30 s, two characters taking turns. Line 1 is the hook: "Did you know…" with the surprising fact in everyday words. The last line closes the loop and ties the fact to daily life. The end card restates the fact in a few words.
- **New characters and a new setting every time.** Never reuse a pair unless the user asks. Pick characters that belong to the fact (honey and a bee, the Moon and a kid, a heart and a red blood cell).
- **Voices:** each character gets a vivid voice description in `animation_voice`'s voices (age, energy, pace, attitude: "Moon: a slow, kind, very old voice, warm and amused"). Make the two clearly different.
- **Shots:** `wide` (both characters), a close-up on whoever speaks, one `diagram` shot that shows the fact (an arrow, a scale, a timeline), and the `end` card last. Cut on line starts.
- **Acting:** the speaker's mouth follows its voice (the library does it from `lines.json`); both characters blink, look at each other, and gesture on their key words. The listener reacts (a nod, a surprised look) on the speaker's key word.
- **Layout:** the speech bubble sits in the top third; keep faces and diagram content below it. Place pointers and circles from the drawing's coordinates, never by guess, and check them in a still.

### The 2D library (`src/toon/`)

Pictures are SVG markup strings for a 1080×1920 world, drawn fresh every frame by `<ToonStage>`, which also draws the speech bubble (the speaker's name and their words lighting up as they are said) and the fun-fact card after the last line. `Animation.tsx` holds `<Voice />`, `<Music />` and `<ToonStage card shots cast defs scene diagram />`; leave `<Captions />` out (the bubble is the captions).

- `shots`: one shot name per recorded line, in order: `wide`, a character's close-up (name it after them), one `diagram`, and `end` last.
- `cast`: `{ bee: { name: 'Bee', bubble: { bg: '#fff', tag: '#F3B33D', tagfg: '#3A2410', now: '#E2574C' } } }`, keyed by the `who` you recorded with.
- `scene(t, i)` returns the world for line i at time t (seconds); `diagram(t, i)` the full-screen diagram. `defs` holds SVG gradients and patterns they use.
- **Timing:** `L` (the recorded lines), `S[i]` (line i's shot starts; `S[L.length]` is the end), `word(i, 'prefix')` (line i's word: `.start`, `.end`; throws if it isn't there), `ss(a, b, t)` (an eased 0→1 between times a and b), `back(x)` (overshoot, for pops), `lerp`, `clamp`, `blink(t, period, offset)`, `speaking(who, t)`, `makeRnd(seed)` (never `Math.random()`).
- **Faces:** `mouthAt(who, t)` follows the voice; draw it with `mouth({ m, w, closed, lip })` (`closed` is the shut mouth's SVG path; pass your own `m` for a silent jaw drop). `eye({ x, y, rx, ry, gaze, iris, r, lid, lidColor, line })`: `lid` 0 open .. 1 shut, `lidColor` must match the skin behind the eye.
- **Bodies:** `arm([sx, sy], { x, y, pose, rot }, color, side)` (a stick arm with a white glove; pose `open`, `point`, `fist` or `thumb`), `legs([x1, x2], top, color, shoe)`, `sparkle(x, y, r, opacity)`, `chip(x, y, text, { size, bg, fg, k })` (a pill label; k scales it in), `INK` (the outline colour).
- **Camera:** `camera(t, i, shots[i], FRAMES)` with `FRAMES = { wide: [x, y, z0, z1], bee: [x, y, z0, z1, punch?], end: [[x, y, z], [x, y, z]] }`; wrap layers in `layer(cam, p, svg)`, p < 1 for far layers (parallax). At zoom z a shot shows 1080/z world pixels across: with the characters about 510 px apart (x ≈ 290 and 800) use z ≈ 1.05-1.1 for wide and ≈ 1.9 for a close-up.
- **Coordinates:** characters stand on a ground line (y ≈ 1520) at x ≈ 290 and 800. A character's own origin is its feet; y goes negative upward.

**Puppet pattern.** Per character, one `xState(t, i)` (defaults, then changes per line keyed by `i` and word times) and one `x(s)` that draws it as an SVG string: body, cheeks, eyes, brows, `mouth` at the face, then arms last (shoulders on the body's edge) so gloves can cross the face. Listeners look at the speaker; add `bob += mouth.open * 4` while speaking; pop gestures in with `back(ss(w.start - 0.2, w.start + 0.2, t))`.

**Diagram pattern.** Its own background; reveal each element on the word that names it; a small copy of the speaker in a corner (the same draw function, scaled, arms off); a takeaway chip near the bottom; content between y 560 and 1850.

A minimal start for `src/scenes/story.ts`:

```ts
import { arm, back, blink, camera, eye, INK, L, layer, legs, mouth, mouthAt, ss, word, type Frames } from '../toon'

export const shots = ['wide', 'bee', 'jar', 'diagram', 'bee', 'end']
const FRAMES: Frames = { wide: [545, 1180, 1.05, 1.1], bee: [290, 1250, 1.85, 1.95, 0.08], jar: [800, 1250, 1.85, 1.95, 0.08], end: [[545, 1180, 1.1], [545, 1100, 1.0]] }

function bee(t: number, i: number) {
  const m = mouthAt('bee', t)
  const gaze: [number, number] = L[i]?.who === 'jar' ? [10, -2] : [2, 2]
  return `<g transform="translate(290,1520)">${legs([-40, 40], -60, '#3A2E1F', '#2B2433')}<ellipse cy="-200" rx="130" ry="150" fill="#FFC93C" stroke="${INK}" stroke-width="8"/>${eye({ x: -45, y: -240, rx: 28, ry: 32, gaze, iris: '#3A2620', r: 15, lid: blink(t, 3.1, 0.2), lidColor: '#FFC93C', line: INK })}${eye({ x: 45, y: -240, rx: 28, ry: 32, gaze, iris: '#3A2620', r: 15, lid: blink(t, 3.1, 0.2), lidColor: '#FFC93C', line: INK })}<g transform="translate(0,-170)">${mouth({ m, w: 46, lip: '#7A3A1A', closed: 'M -20,-2 Q 0,12 20,-2' })}</g>${arm([-125, -190], { x: -170, y: -90 }, '#3A2E1F', -1)}${arm([125, -190], { x: 170, y: -90 }, '#3A2E1F', 1)}</g>`
}

export function scene(t: number, i: number) {
  const cam = camera(t, i, shots[i] ?? 'wide', FRAMES)
  return layer(cam, 0.6, `<rect x="-400" y="-200" width="1900" height="1800" fill="#BDE7FF"/>`) + layer(cam, 1, `<rect x="-400" y="1520" width="1900" height="600" fill="#8BC34A"/>${bee(t, i)}`)
}

export function diagram(t: number, i: number) {
  const w = word(i, 'water')
  return `<rect width="1080" height="1920" fill="#FFF4E0"/><circle cx="540" cy="1000" r="${200 * back(ss(w.start - 0.2, w.start + 0.2, t))}" fill="#4CC9F0"/>`
}
```

## Sound and music

A video with only a voice feels flat. Sound effects and a picture that moves with the music are what make it feel alive.

**Sound effects.** `<Sfx name="pop" at={word(2, 'three').start} />` from `src/kit.tsx` plays one at a moment in seconds (or list them as `SoundCue`s and put `<Sounds cues={SOUNDS} />` in `Animation.tsx`). `volume` 0..1: about 0.3 while someone speaks, 0.5-0.7 between lines; the voice always stays on top.
- Every entrance gets its sound on its frame: an icon or picture popping in (`pop`, `bubble`), a panel or text sliding in (`swish`, `whoosh` for big moves), a headline typing in (`typing`), a counter or number (`tick` per step, `coin` when it lands), a photo (`shutter`), a fact landing or a right answer (`ding`, `chime`), something growing or flying up (`slide-up`), dropping or shrinking (`slide-down`), a bounce or surprise (`boing`), magic or stars (`twinkle`, `shimmer`), the big reveal or the end card (`tada`, `riser` leading into it).
- About one every 1-2 seconds, none within 0.15 s of another, and varied: the same sound on every entrance becomes noise.
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

**Move with the music.** `src/beat.ts` has the music's grid (`music.bpm`, `beats`, `downbeats`, `kicks`, `snares`, `accents`, `sections`, in seconds; empty with no music). `beatPulse(t, 'beats')` is 1 on each beat easing to 0: give what is already on screen a small life on the beat (a background shape breathing 2-4%, a glow, a bounce of an icon, the ticker's dot). Land entrances that aren't tied to a word on the music with `onBeat(t)`, the bigger changes (a new panel, a scene's set) on a downbeat (`nextBeat(t, 'downbeats')`) or a section start (`sectionAt(t)`). Keep it light: one or two things pulse, never the whole frame on every beat.

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
