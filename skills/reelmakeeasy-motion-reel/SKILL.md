---
name: reelmakeeasy-motion-reel
description: How to plan and build a ReelMakeEasy Motion Reel (a short motion-graphics video in Remotion, timed to its music). Use in every Motion Reel chat, before planning, writing scenes, rendering or changing a reel.
---

# Motion Reels

A Motion Reel is a short motion-graphics video (an intro, a launch, a showreel) written as a Remotion project and timed to its music. The music, the cuts and the sound effects all sit on one clock: the beat grid. A reel looks good when the picture moves with the music: worlds change with its sections, cuts land on its beats, and its kick, snare and melody drive what moves.

## The project

ReelMakeEasy sets the project up in `reel/`: before your first turn when the user filled in the setup card, or when you call `motion_setup` in an Advanced chat (which has no card; call it with no arguments to list the styles and music first). Either way you get:
- `reel/brief.md`: what the user asked for (style, subject, length, ratio, music, reference).
- `reel/style.md`: the chosen style card (look, type, motion, pacing and sound, build notes). Follow it; where it clashes with the craft rules below, they win and the style bends: a type-led style lays its words over a moving visual layer, a minimal one keeps its ground and changes worlds through the hero visual and the accent colour.
- `reel/music-map.md`: the music bar by bar, in beat numbers: its sections and energy, and where the kicks, snares, melody notes (accents marked) and chord changes fall. Plan from it.
- `reel/public/reel.json`: size, frame rate, length in whole bars, tempo, the music's beats, bar starts and strongest hits, and its `events` (the music map's data), in seconds from the reel's first frame.
- `reel/public/music.wav`: the music, already trimmed to the reel's bars (absent for a reel without music).
- `reel/public/sfx/*.wav`: the sound pack.
- `reel/public/reference/`: when the user gave a reference. A video: `contact-sheet.png` (16 frames of its opening) and `rhythm.json` (its cuts and how they sit on its beat): take its look and rhythm, never its content. A website: `site-1.png` to `site-3.png` (its home page, top to bottom) and `brand.json` (colours, fonts, headline); when it is the subject's own, its colours, words and screenshots may go in the reel (`<Img src={staticFile('reference/site-1.png')} />`).
- `reel/src/grid.ts` (the clock and the music events), `reel/src/kit.tsx` (music, sound effects, easings, the music hooks), `reel/src/transitions.tsx` (shots and transitions) and `reel/src/Reel.tsx` (a starter you replace). ReelMakeEasy owns the first three and refreshes them: use them, never edit them; put your own helpers in `src/scenes/`.

Remotion is installed. Its own skills (`remotion-best-practices`, `remotion-markup`, `remotion-multimedia`) have its API in detail; where they differ, follow this skill (here ReelMakeEasy sets the project up and renders).

## How to work

1. **Read** `brief.md`, `style.md`, `music-map.md`, and the reference files when there are any (open the images and look at them).
2. **Plan from the music.** One *world* per section: its own ground, colour, technique and motion. Write `reel/plan.md`, per section: its bars, energy, world and the transition into it; per scene: its beats, what is on screen, and what the kick, melody and snare drive. Write the plan in your reply as one short line per scene (not the file itself, and not only in your thinking: the user can't see that), then ask if it's good, unless they already said to go ahead.
3. **Build.** One component per scene in `reel/src/scenes/`, placed in `Reel.tsx` as `<Shot from={bar(n)} to={bar(m)}>` (from `transitions.tsx`). Fonts come from `@remotion/google-fonts` (the style card names them). Images and logos only from `reel/public/`.
4. **Look.** Call `motion_still` on the important frames (each section's first beat, each scene's busiest moment) and look at the images. Fix what is cut off, too small, crowded, off-palette or off-style before rendering.
5. **Render and sync.** Call `motion_render`. It renders the reel, evens out the loudness, shows it to the user, and reports the sync: cuts on the grid, section starts marked, accented melody notes answered, the kick pulse, enough shot changes, and stills, with the beat of every miss. When it fails, fix what it lists at the beats it names and render again: at most 3 renders, then say what is still off. A passing check needs no more renders.
6. **Change it** when the user asks: edit the scene, look at a still, render again. Say what you changed in one line.

## Timing rules (the clock)

- Time everything with `grid.ts`: `beat(n)`, `bar(n)`, `beats(k)`, `bars(k)`, and the music as frames: `kicks()`, `snares()`, `melody(minStrength)` (0.8 and up = accents), `chordChanges()`, `sections()` (`{ name, energy, from, to }`), `sectionAt(frame)`, `eventsBetween(list, from, to)`, `beatOf(frame)`. Never type a frame number or a duration in seconds.
- **Section starts get a world change** with a designed transition: `<Shot exit="whip">` on the outgoing shot and `enter="whip"` (same `direction`) on the next, or `"zoom"` (zoom through), `"wipe"` (mask wipe), `flash` (a 3-frame light flash on the cut; `<Flash at={bar(n)} />` anywhere), or a match cut through a shared shape. The move starts on the cut and takes half a beat: put the incoming shot right after the outgoing one in `Reel.tsx`.
- **Inside a section, hard cuts** on downbeats or beats (half beats only in a fast run). The biggest picture change of a bar sits on its biggest musical moment (an accent, a crash, a stab).
- **Three layers.** The kick drives a continuous background pulse: `const pulse = usePulse(kicks())`, then a scale of `1 + 0.02 * pulse`, a glow or a grid flash. The snare gives secondary accents (`usePulse(snares())` on a second element: a flicker, a shake). The melody brings elements in: take the scene's own notes, `const notes = eventsBetween(melody(0.8), bar(8), bar(12))`, then `usePopOn(notes, i)` pops element i (a word, a letter, a card, an icon, a shape) on the scene's i-th accented note; `useHitIndex(frames)` says which event the reel is past. These hooks and `useProgressAt(beat(n), beats(1))`/`useOvershootAt(beat(n))` take reel frames and work in any scene; `useProgress` and `useOvershoot` count from the scene's first frame, so never give them `beat()`.
- Hold any text for at least one beat (except in the climax run); two beats for six words or more.
- **The climax:** one word or one visual per beat (per half beat for a last run) for 1-2 bars, each in its own look.
- **The end card** lands on the last bar's downbeat and holds it while the music fades (`<Music />` fades it for you).

## Music

The music is the reel's clock. It comes from the library, the user's own file, or you: `motion_music` puts the music you make under the reel, the way the user picked (its `engine`). Then read `music-map.md` and `public/reel.json` again (bars, tempo and events change) and re-check timing that assumed the old grid.

- **Composed by you (`engine: "composer"`, free, recommended).** Read the `reelmakeeasy-music-composer` skill and follow it: you write `music/music.mjs` note by note (its own sound world, harmony, bass and motif for this reel), set `bpm` in `music/reel.config.mjs`, run `cd reel/music && node tools/score.mjs --no-cues` in your shell, fix what its QC flags, then call `motion_music` with `engine: "composer"` and no prompt. The sections add up to the reel's bars at your tempo: round(length x bpm / 240); the reply says the count if it is off. Plan the music and the picture together: a section per world, the drop on your biggest reveal. Its events are exact: the kicks, snares and claps you wrote, the motif's notes as `melody(0.8)` (pop elements on them), your chord changes and sections.
- **A music model (`engine: "eleven-music"` or `"ace-step"`, paid).** Write its prompt for this reel: genre, mood and instruments for the style and subject, a tempo in the style card's range, and its shape in bars (an intro that builds, a riser into a drop on the biggest moment, an ending that resolves). For a launch or a showreel: punchy drums, a clear hook, a real drop. One generation per request, never to try things. Its events are found by ear: check them in `music-map.md`.

## Sound effects

Place them with `<Sfx name="…" at={beat(n)} />`: one per transition or impact, never more than two on one frame, volume 0.4 to 0.8 under the music. A `riser` peaks on its frame (it starts two seconds earlier), so put it on the drop. The pack:
- `whoosh`: an air whoosh (transitions, big moves across the frame)
- `swish`: a fast light swish (small moves, text sliding in)
- `riser`: a 2-second build that ends on its frame (place it to end on the drop; the file starts 2 s earlier)
- `tick`: a crisp tick (counters, timecode, every cut in precise styles)
- `click`: a dry UI click (buttons, toggles, a cursor press)
- `pop`: a bubbly pitch-drop pop (shapes, icons or cards appearing)
- `hit`: a punchy low impact with a crack (big title slams, the drop)
- `sub-drop`: a deep falling boom (scene drops, dark reveals)
- `glitch`: a short digital stutter (glitch cuts, data, tech reveals)
- `shimmer`: a bright sparkle tail (logo reveals, end cards)

## Craft rules

- **Range.** At least 3 worlds in a 15 s reel, 4 in 30 s, 6 in 60 s. Mix techniques: kinetic type, particles forming a shape, shape morphs, a product UI rebuilt in code (cards dropping in, a chat box being typed, a chart drawing), depth (perspective, a tunnel, an orbit), fluid blobs, data viz, a logo build.
- **Text sits on a visual.** Words are one short line over something visual, never the whole picture; never two text-only scenes in a row.
- **Show the product working.** When the subject is a product, rebuild its UI in code (from the reference screenshots when the user gave its website) for at least one bar.
- **Never still.** Something moves on every frame outside the end card; no stretch over one beat without motion. The kick pulse fades within half a beat and kicks can be bars apart (backbeat, half time, energy 0-1), so give every ground a constant drift too.
- Keep text and key shapes inside a 6% safe margin. Measure long lines with `measureText`/`fitText` from `@remotion/layout-utils` instead of guessing sizes; nothing may run off the frame.
- The smallest text is at least 3% of the frame height. A vertical (9:16) reel stacks what a wide one puts side by side (`isVertical` in grid.ts).
- Stay inside the style's palette and fonts. Ease every move (`ease.snap`, `ease.glide`, `useOvershoot`); nothing moves linearly except constant drifts. Keep it deterministic: no `Math.random()` (use `random(seed)` from Remotion), no CSS transitions.
- Use the subject from the brief for every word on screen; never copy a video reference's text, logo or footage.
- Type-check with `npx tsc --noEmit` inside `reel/` when you change several files.
- Never run `remotion render`, `remotion still` or `npm install` yourself: `motion_still` and `motion_render` render for you, and everything you need is installed.

## The styles

- **HUD Showreel** (`hud-showreel`): A designer showreel: bold colour cards inside a viewfinder HUD, cut on the beat.
- **Kinetic Type** (`kinetic-type`): Words as the visuals: giant type punching in on every beat.
- **Product UI Launch** (`product-ui-launch`): An app launch: the product UI, a cursor, smooth zooms and short feature callouts.
- **Data Story** (`data-story`): An infographic reel: big numbers counting up, charts drawing on to the beat.
- **Bauhaus Shapes** (`bauhaus-shapes`): Flat geometric shapes in primary colours, morphing and snapping on a grid.
- **Dark Precision** (`dark-precision`): Calm and exact: black, hairlines, mono labels and a click on every cut.
- **Glass & Neon** (`glass-neon`): A sleek SaaS promo: frosted-glass cards and neon glow on a dark gradient.
- **Minimal Keynote** (`minimal-keynote`): Keynote restraint: one big statement at a time and lots of white space.
- **Retro Pixel** (`retro-pixel`): Retro: pixel art or a synthwave grid, with chiptune energy.
