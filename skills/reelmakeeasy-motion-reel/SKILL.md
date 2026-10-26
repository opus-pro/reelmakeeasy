---
name: reelmakeeasy-motion-reel
description: The mechanics of a ReelMakeEasy Motion Reel (a short motion-graphics video in Remotion, timed to its music), with its project files, helpers, tools, technical rules and its rules for pace, transitions and review. Use in every Motion Reel chat, before planning, writing scenes, rendering or changing a reel.
---

# Motion Reels

A Motion Reel is a short motion-graphics video written as a Remotion project in `reel/` and timed to its music on one clock, the beat grid. This skill covers the mechanics and the rules for pace, space and review. The creative method comes from the reel's type (in `brief.md`) and the user: you decide the look.

## The project

ReelMakeEasy sets the project up in `reel/`: before your first turn when the user filled in the setup card, or when you call `motion_setup` in an Advanced chat (call it with no arguments first to list the reel types, lengths, frames and music). Either way you get:
- `reel/brief.md`: what the user asked for: the type (`launch`, a product launch, or `showreel`, a motion reel), subject, length, frame, music and reference.
- `reel/music-map.md`: the music bar by bar, in beat numbers: its sections and energy, and where the kicks, snares, melody notes (accents marked) and chord changes fall.
- `reel/public/reel.json`: size, frame rate, length in whole bars, tempo, the music's beats, bar starts and strongest hits, and its `events` (the music map's data), in seconds from the reel's first frame.
- `reel/public/music.wav`: the music, already trimmed to the reel's bars (absent for a reel without music, which runs on a steady grid).
- `reel/public/sfx/*.wav`: the sound pack (below).
- `reel/public/reference/`: when the user gave a reference. A video: `contact-sheet.png` (16 frames of its opening) and `rhythm.json` (its cuts and how they sit on its beat); take its look and rhythm, never its content. A website: `site-1.png` to `site-3.png` (its home page, top to bottom) and `brand.json` (colours, fonts, headline); when it is the subject's own, its colours, words and screenshots may go in the reel (`<Img src={staticFile('reference/site-1.png')} />`).
- `reel/src/grid.ts`, `reel/src/kit.tsx` and `reel/src/transitions.tsx`: the helpers below. ReelMakeEasy owns them and refreshes them: use them, never edit them. `reel/src/Reel.tsx` is a starter you replace; put your scenes and own helpers in `reel/src/scenes/`.
- `reel/plan.md` is yours to write; the Tasks panel shows it to the user.

## The plan

Write `reel/plan.md` before you build, one short block per scene: its seconds and its beats or bars (`bar(2)` to `bar(4)`); the one idea it shows; what is on screen and where; its transition in and out and how each joins the neighbouring scene (and, for the one or two moments that use depth, what waits behind); and what keeps moving. Then write the plan in your reply text too, not only in your thinking (the user sees neither your thinking nor the file): one short line per scene with its beats or bars. Only then ask whether to build it, below the plan in the same reply; never ask "Build this plan?" without the plan above it. When the user changes something, update `plan.md` and show the new plan again.

Remotion is installed. Its own skills (`remotion-best-practices`, `remotion-markup`, `remotion-multimedia`) have its API in detail; where they differ, follow this skill (here ReelMakeEasy sets the project up and renders).

## Pace

- One idea gets at most 4 s. A scene runs over 8 s only with a reason written in the plan (the end card, a long camera move that joins two ideas). The sync check never reads the plan: it finds shots from cuts and big changes, so a long joining move needs a visible change at each idea (a new element arriving, a reveal, a flash) or it is measured as one shot, and a shot over 8 s fails.
- A light screen (a score, a stat, a title) gets 1-2 s: animate it in on the beat, land, move on. Three scores slide in, the best one is picked, the reel slides on.
- An idea that needs longer is split into two different shots on the same topic (4 s + 4 s), never one long scene.

## Transitions and depth

- Most scenes are flat and clean: strong 2D layout, type, cards and UI, facing the camera. Depth (CSS `perspective` with `translateZ`/`rotateX`/`rotateY`, or three.js) is one tool among many, not the look: use it for one or two moments in a 30 s reel where space helps the idea (a slide that opens onto the next scene already waiting behind, a push through a layer, cards flying into a wall). Tilting, rotating or receding everything reads as forced; never add depth for its own sake.
- Transitions join two scenes: the next scene is ready before the move reveals it, so the cut never lands on an empty frame. Joins can be flat (a shared element carried from one scene into the next, a slide or wipe that uncovers the next scene already in place, a match cut on a shape) or, sparingly, in depth. Plain hard cuts on the beat are fine too.

## No stall frames

- Something visible moves on every frame. Each animation lands on a beat and is followed by secondary motion big enough to see (a camera push, an element sliding or turning, a large counter, the next element coming in), never a frozen hold. A slow drift (2% of the width a second) or a glow alone reads as still.
- A hold lasts at most 0.5 s; only the end card holds longer, plus once a reel a payoff beat (a score landing on its best value) of up to 1.5 s. The end card holds from its own shot when that starts on a cut or a big change in the reel's last fifth and at most 6 s from the end; otherwise only the last bar or the last 1.5 s (whichever is longer) may hold. The sync report fails any other near-still stretch of 0.5 s or more, and a shot over 8 s.

## The review loop

Nothing is one-shot. After every render, call `motion_review` and open every contact sheet it returns. Write `reel/review.md`: the problems by time (stalls, scenes over 4 s or 8 s, transitions that land on an empty frame, depth used everywhere or for its own sake, empty or crowded frames, clipped text, moments off the music), and for each one the change of strategy (more motion, more elements, split the scene, a better join), not only a tweak. If your harness has a subagent, give a fresh reviewer subagent the sheets and `plan.md` and act on its findings too: it did not write the scenes. Then fix, render and review again, up to 3 rounds. Never tell the user the reel is done after one render.

## The helpers

- **`grid.ts`, the clock.** `beat(n)` and `bar(n)` give the frame of beat or bar n (from 0); `beats(k)` and `bars(k)` give a length in frames. The music as frames: `kicks()`, `snares()`, `melody(minStrength)` (0.8 and up = accents), `chordChanges()`, `hitFrames()`, `sections()` (`{ name, energy, from, to }`), `sectionAt(frame)`, `eventsBetween(list, from, to)`, `beatOf(frame)`. Also `grid` (reel.json), `beatSec`, `frameAt(seconds)` and `isVertical`.
- **`kit.tsx`, sound and motion.** `<Music />` plays `music.wav` and fades it at the end; `<Sfx name="…" at={beat(n)} />` plays a sound effect; `<Scene from={beat(n)} forBeats={k}>` is a plain sequence; the easings are `ease.glide` (ease-in-out), `ease.snap` (ease-out) and `ease.anticipate` (winds up, then overshoots), and the progress helpers default to `ease.snap`. `useProgress(start, frames)` and `useOvershoot(start)` count from the first frame of the scene; `useProgressAt(at, frames)`, `useOvershootAt(at)`, `useReelFrame()`, `usePulse(frames)` (1 on each event, easing to 0), `useHitIndex(frames)` (which event the reel is past) and `usePopOn(frames, i)` (element i pops on the i-th event) take reel frames, so they work in any scene.
- **`transitions.tsx`, shots.** `<Shot from={bar(n)} to={bar(m)}>` places a scene; `exit` on the outgoing shot and the same `enter` and `direction` on the next give a transition (`"whip"`, `"zoom"`, `"wipe"`) that starts on the cut and takes `transitionBeats` (half a beat); put the incoming shot right after the outgoing one. `flash` on a shot, or `<Flash at={bar(n)} />` anywhere, is a 3-frame light flash. `whipIn`, `whipOut`, `zoomThrough`, `maskWipe` and `transitionStyle` are the same moves as CSS style objects. These are flat moves, fine for most cuts; the incoming shot only exists from the cut. For the one or two joins in depth, put both scenes in one `<Sequence>` inside one `perspective` container and move the camera through them, or mount the next scene before the cut, waiting behind (negative `translateZ`) or beside the current one, and let the move reveal it.

Time everything with these: never type a frame number or a duration in seconds.

## The tools

- `motion_setup` (Advanced chats only): sets `reel/` up from the type, subject, length, frame, music and reference; with no arguments it lists the options. Calling it again keeps your scenes and plan.
- `motion_music`: puts music you make under the reel, the way the user picked (its `engine`), and rewrites `public/music.wav` and `public/reel.json`. Then read `music-map.md` and `reel.json` again (bars, tempo and events change) and re-check timing that assumed the old grid.
  - `engine: "composer"` (free, recommended): read the `reelmakeeasy-music-composer` skill and follow it. You write `music/music.mjs`, set `bpm` in `music/reel.config.mjs`, run `cd reel/music && node tools/score.mjs --no-cues` in your shell, fix what its QC flags, then call `motion_music` with `engine: "composer"` and no prompt. The sections add up to the reel's bars at your tempo, round(length x bpm / 240); the reply says the count if it is off. Its events are exact.
  - `engine: "eleven-music"` or `"ace-step"` (paid): pass a prompt (and a tempo). One generation per request, never to try things. Its events are found by ear: check them in `music-map.md`.
- `motion_still`: renders single frames at the beats you pass (at most 6) and gives them back as pictures; open each one and look at it. The user sees them too.
- `motion_render`: type-checks, renders the reel, evens out the loudness, shows it to the user and returns a sync report: how the picture sits on the music (cuts on the grid, section starts, accented melody notes, shot changes), with the beat of every miss, plus the kick pulse as information only (not required: a pulse on every kick of the whole reel reads as repetitive). It also reports the pace: shots over 4 s or 8 s and stalls. Whether it passes or not, call `motion_review` next: the fixes go through `reel/review.md`. At most 3 renders, one per review round, then say what is still off.
- `motion_review`: lays the rendered reel out as contact sheets (a frame every 0.5 s, 8 frames a row, so one row is 4 s; `every: 1` for 1 s, `from`/`to` for a stretch) and shows them to you and the user, with a pace report: each shot's start and length (long over 4 s, too long over 8 s), every stall of 0.5 s or more by time and beat, and a verdict. Call it after every `motion_render`.

## Sound effects

Place them with `<Sfx name="…" at={beat(n)} />` (volume 0.4 to 0.8 under the music). A `riser` peaks on its frame (it starts two seconds earlier). The pack:
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

## Hard rules

- Work only inside `reel/`. Images and logos only from `reel/public/`.
- Keep it deterministic: no `Math.random()` (use `random(seed)` from Remotion), no `Date`, no CSS transitions or animations; every value comes from the frame.
- Ease every move: ease-in-out (`ease.glide`) for a move from rest to rest, ease-out (`ease.snap`) or a spring (`useOvershoot`) for an entrance or a landing, ease-in (`Easing.in(...)`) for an exit that leaves the frame. Linear motion is the last option: only for motion meant to be constant (a slow background drift, a scrolling ticker, a turning ring, a counter), and say why in the plan. Never pass `interpolate` a range without an `easing` for a move that starts or stops on screen.
- Never run `remotion render`, `remotion still` or `npm install` yourself: `motion_still` and `motion_render` render for you, and everything you need is installed.
- Fonts only through `@remotion/google-fonts`.
- Keep text and key shapes inside a 6% safe margin; measure long lines with `measureText`/`fitText` from `@remotion/layout-utils`, so nothing runs off the frame.
- Every word on screen comes from the brief's subject (or the subject's own website); never copy a video reference's text, logo or footage.
- Type-check with `npx tsc --noEmit` inside `reel/` when you change several files.
