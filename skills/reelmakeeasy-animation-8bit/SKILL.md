---
name: reelmakeeasy-animation-8bit
description: How to write and build a ReelMakeEasy Claude Animation in the 8-bit look (a narrated pixel-art explainer like an old video game, drawn in code with three.js in Remotion). Use in every 8-bit Claude Animation chat, before writing the script, recording the voice, building scenes, rendering or changing it.
---

# Claude Animation: 8-bit

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
2. **Write the script** the look asks for (below), and a plan of one short line per scene (what is said, what is on screen). Write both as your reply's text, the script as "Who: words" rows (not only in a file or your thinking: the user can't see those), then ask if it's good, unless they already said to go ahead. Never ask to build a script the user hasn't read.
3. **Record the voices** with `animation_voice`: `lines` one "Who: words" per row, in order, and `voices` one "Who: description" per speaker. It keeps takes that say your words and match each speaker; listen to the lines it warns about (ask the user). When the total is much longer than the length asked for, shorten the script and record again.
4. **Make the music** with `animation_music` only when the brief says you make it.
5. **Build.** One component per scene in `src/scenes/`, placed in `Animation.tsx` with `<Sequence from={lineStart(i)}>` so every scene starts on its line. Keep `<Voice />`, `<Music />` and `<Captions />` in `Animation.tsx` (captions in the look's palette and font).
6. **Look.** Call `animation_still` on the important moments (each scene's start and its key word) and look at the images. Fix what is cut off, too small, crowded, off-palette or off-look before rendering.
7. **Render** with `animation_render`: it shows the video to the user. You can't hear it: say so and ask the user to listen to the voices.
8. **Change it** when the user asks: edit the scene (record again only when the words change), look at a still, render again. Say what you changed in one line.

## Timing rules

- Time everything to the voice with `clock.ts`: `lineStart(i)`, `lineEnd(i)`, `wordAt(i, w)` (line i's word w), `sec(s)` for durations. Never type a frame number for a moment in the story: then the picture still fits when a line is recorded again.
- A picture change lands on the word it shows (the number appears on "500", the arrow on "flows").
- `useMouth(who)` gives a speaker's mouth (0..1) and vowel on every frame; `useSpeaking()` says who is talking.

## The 8-bit look: a narrated pixel-art explainer

A low-resolution 3D scene drawn blocky and dithered like an old video game, with crisp pixel-font captions and labels on top, and a narrator.

- **Script:** about 2.3 words per second of length, one narrator. The hook comes first: a big number plus the question ("632 METRES. 128 FLOORS. WHY IS IT TWISTED?"), in everyday words. Then one idea per caption, a new caption every 1.5-2.5 s, and an ending that closes the loop and ties it to daily life. The last shot returns to the first, so the video loops.
- **Voice:** one narrator in `animation_voice` ("Narrator: an upbeat, clear voice with a smile, like a game show host").
- **A busy screen:** at least 3 layers move at any moment (the hero, life around it, weather or flows, the HUD).
- **The hero has real detail** and stands out; everything else is smaller, muted and sparser.
- **Teach with pictures:** an animated diagram for each idea, an x-ray cutaway for the insides with labels on the inside parts, and a stamp ("RESONANCE!") with a flash on the big moments.
- **The camera never parks:** orbit, crane and spiral in 3D, with a shake on the big hits.
- The library is in `src/pixel/` (the pixel stage, the HUD, x-ray): read its `index.ts` before you build.

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
