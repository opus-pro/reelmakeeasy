---
name: reelmakeeasy-animation-3d
description: How to write and build a ReelMakeEasy Claude Animation in the 3D look (a narrated explainer around one detailed 3D object, drawn in code with three.js in Remotion). Use in every 3D Claude Animation chat, before writing the script, recording the voice, building scenes, rendering or changing it.
---

# Claude Animation: 3D

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

## The 3D look: a narrated 3D explainer

One detailed 3D hero (an object, a machine, an organ, a planet) explains how something works, with a narrator.

- **Script:** about 2.3 words per second of length (70 words for 30 s), one narrator. A hook first ("Did you know…" with the surprising fact in everyday words), one idea per scene, and an ending that closes the loop and ties it to daily life.
- **Voice:** one narrator in `animation_voice` ("Narrator: a warm, clear, curious voice, unhurried").
- **The hero has real detail** and stands out; everything else is simpler and muted. Build it from three.js shapes (no downloaded models).
- **One idea per scene,** each with a visual change on its key word: a part lights up, the hero opens, a cutaway shows the inside, an arrow shows the flow.
- **Labels** on the parts being explained, with leader lines, at least 3% of the frame height.
- **The camera never parks:** orbit, crane, push in, spiral, slowly and eased.

### The 3D library (`src/stage/`)

`Animation.tsx` holds `<Voice />`, `<Music />`, `<Stage3D build={build} />` (optionally `background="#0E1116"`) and `<Captions accent="…" />` after it. `build(E, font)` in `src/scenes/episode.ts` makes the whole scene once and returns `{ update(t) }`, which sets everything from t (seconds) alone: no state carried between frames.

- **Engine `E`:** `scene` (studio light, a dark ground at y 0 fading into fog are already there), `camera` (35° PerspectiveCamera), `renderer` (shadows on: set `castShadow` on the hero's meshes), `labels` (the label layer, cleared every frame), `toScreen(vec3)` → `[x, y, inFront]`, `sync()`.
- **Order inside `update(t)`:** move and scale parts, set the camera, `camera.updateProjectionMatrix()`, `sync()`, then the labels.
- **Camera:** `cam.orbit(E.camera, t, { target, radius, height, from, speed })` circles the hero; `cam.move(E.camera, t, a, b, from, to, target)` pushes in, cranes or pulls back between times a and b. Chain them per scene with `t` ranges from `lineStart(i) / 30`.
- **Labels:** `label(E.labels, 'LEFT VENTRICLE', E.toScreen(point), [ox, oy], { k, color, fontFamily: font })` draws a dot, a leader line and the text (58 px, kept inside the margin); grow it in with `k = ss(start, start + 0.5, t)` on its word.
- **Helpers:** `THREE`, `mat(color, { roughness, metalness })`, `emissive(color, k)` (a part that lights up), `ss`, `back`, `lerp`, `clamp`, `rng(seed)` (never `Math.random()`).
- Build the hero from three.js shapes (spheres, cylinders, tori, `LatheGeometry`, `ExtrudeGeometry`, `TubeGeometry` along a curve) with enough parts to look real, and animate what it does (a beat, a turn, a flow along a tube with small instanced spheres). A cutaway: hide the outer shell with `ss` and show the inside.

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
