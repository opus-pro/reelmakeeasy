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
5. **Build.** One component per scene in `src/scenes/`, placed in `Animation.tsx` with `<Sequence from={lineStart(i)}>` so every scene starts on its line. Keep `<Voice />`, `<Music />` and `<Captions />` in `Animation.tsx` (captions in the look's palette and font).
6. **Look.** Call `animation_still` on the important moments (each scene's start and its key word) and look at the images. Fix what is cut off, too small, crowded, off-palette or off-look before rendering.
7. **Render** with `animation_render`: it shows the video to the user. You can't hear it: say so and ask the user to listen to the voices.
8. **Change it** when the user asks: edit the scene (record again only when the words change), look at a still, render again. Say what you changed in one line.

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
