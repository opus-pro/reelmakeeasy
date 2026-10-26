import { SFX_DESCRIPTIONS, SFX_NAMES } from '@reelmakeeasy/common/motion-reel/sfx'
import { MOTION_REEL_STYLES } from '@reelmakeeasy/common/motion-reel/styles'

export const MOTION_REEL_SKILL_NAME = 'reelmakeeasy-motion-reel'

/** The tools a Motion Reel chat has (agent-tools.ts implements them). */
export const MOTION_STILL_TOOL = 'motion_still'
export const MOTION_RENDER_TOOL = 'motion_render'
export const MOTION_MUSIC_TOOL = 'motion_music'
export const MOTION_SETUP_TOOL = 'motion_setup'

/**
 * The `reelmakeeasy-motion-reel` skill: how a Motion Reel is planned and built from its music (one
 * world per section, cuts on the beats, the kick, snare and melody driving the picture), in Remotion. ReelMakeEasy writes it into the agent's skills at every session start;
 * `skills/reelmakeeasy-motion-reel/SKILL.md` is the checked-in copy.
 */
export function renderMotionReelSkill(): string {
  return [
    '---',
    `name: ${MOTION_REEL_SKILL_NAME}`,
    'description: How to plan and build a ReelMakeEasy Motion Reel (a short motion-graphics video in Remotion, timed to its music). Use in every Motion Reel chat, before planning, writing scenes, rendering or changing a reel.',
    '---',
    '',
    '# Motion Reels',
    '',
    'A Motion Reel is a short motion-graphics video (an intro, a launch, a showreel) written as a Remotion project and timed to its music. The music, the cuts and the sound effects all sit on one clock: the beat grid. A reel looks good when the picture moves with the music: worlds change with its sections, cuts land on its beats, and its kick, snare and melody drive what moves.',
    '',
    '## The project',
    '',
    `ReelMakeEasy sets the project up in \`reel/\`: before your first turn when the user filled in the setup card, or when you call \`${MOTION_SETUP_TOOL}\` in an Advanced chat (which has no card; call it with no arguments to list the styles and music first). Either way you get:`,
    '- `reel/brief.md`: what the user asked for (style, subject, length, ratio, music, reference).',
    '- `reel/style.md`: the chosen style card (look, type, motion, pacing and sound, build notes). Follow it; where it clashes with the craft rules below, they win and the style bends: a type-led style lays its words over a moving visual layer, a minimal one keeps its ground and changes worlds through the hero visual and the accent colour.',
    '- `reel/music-map.md`: the music bar by bar, in beat numbers: its sections and energy, and where the kicks, snares, melody notes (accents marked) and chord changes fall. Plan from it.',
    "- `reel/public/reel.json`: size, frame rate, length in whole bars, tempo, the music's beats, bar starts and strongest hits, and its `events` (the music map's data), in seconds from the reel's first frame.",
    "- `reel/public/music.wav`: the music, already trimmed to the reel's bars (absent for a reel without music).",
    '- `reel/public/sfx/*.wav`: the sound pack.',
    "- `reel/public/reference/`: when the user gave a reference. A video: `contact-sheet.png` (16 frames of its opening) and `rhythm.json` (its cuts and how they sit on its beat): take its look and rhythm, never its content. A website: `site-1.png` to `site-3.png` (its home page, top to bottom) and `brand.json` (colours, fonts, headline); when it is the subject's own, its colours, words and screenshots may go in the reel (`<Img src={staticFile('reference/site-1.png')} />`).",
    '- `reel/src/grid.ts` (the clock and the music events), `reel/src/kit.tsx` (music, sound effects, easings, the music hooks), `reel/src/transitions.tsx` (shots and transitions) and `reel/src/Reel.tsx` (a starter you replace). ReelMakeEasy owns the first three and refreshes them: use them, never edit them; put your own helpers in `src/scenes/`.',
    '',
    'Remotion is installed. Its own skills (`remotion-best-practices`, `remotion-markup`, `remotion-multimedia`) have its API in detail; where they differ, follow this skill (here ReelMakeEasy sets the project up and renders).',
    '',
    '## How to work',
    '',
    '1. **Read** `brief.md`, `style.md`, `music-map.md`, and the reference files when there are any (open the images and look at them).',
    "2. **Plan from the music.** One *world* per section: its own ground, colour, technique and motion. Write `reel/plan.md`, per section: its bars, energy, world and the transition into it; per scene: its beats, what is on screen, and what the kick, melody and snare drive. Write the plan in your reply as one short line per scene (not the file itself, and not only in your thinking: the user can't see that), then ask if it's good, unless they already said to go ahead.",
    '3. **Build.** One component per scene in `reel/src/scenes/`, placed in `Reel.tsx` as `<Shot from={bar(n)} to={bar(m)}>` (from `transitions.tsx`). Fonts come from `@remotion/google-fonts` (the style card names them). Images and logos only from `reel/public/`.',
    `4. **Look.** Call \`${MOTION_STILL_TOOL}\` on the important frames (each section's first beat, each scene's busiest moment) and look at the images. Fix what is cut off, too small, crowded, off-palette or off-style before rendering.`,
    `5. **Render and sync.** Call \`${MOTION_RENDER_TOOL}\`. It renders the reel, evens out the loudness, shows it to the user, and reports the sync: cuts on the grid, section starts marked, accented melody notes answered, the kick pulse, enough shot changes, and stills, with the beat of every miss. When it fails, fix what it lists at the beats it names and render again: at most 3 renders, then say what is still off. A passing check needs no more renders.`,
    '6. **Change it** when the user asks: edit the scene, look at a still, render again. Say what you changed in one line.',
    '',
    '## Timing rules (the clock)',
    '',
    '- Time everything with `grid.ts`: `beat(n)`, `bar(n)`, `beats(k)`, `bars(k)`, and the music as frames: `kicks()`, `snares()`, `melody(minStrength)` (0.8 and up = accents), `chordChanges()`, `sections()` (`{ name, energy, from, to }`), `sectionAt(frame)`, `eventsBetween(list, from, to)`, `beatOf(frame)`. Never type a frame number or a duration in seconds.',
    '- **Section starts get a world change** with a designed transition: `<Shot exit="whip">` on the outgoing shot and `enter="whip"` (same `direction`) on the next, or `"zoom"` (zoom through), `"wipe"` (mask wipe), `flash` (a 3-frame light flash on the cut; `<Flash at={bar(n)} />` anywhere), or a match cut through a shared shape. The move starts on the cut and takes half a beat: put the incoming shot right after the outgoing one in `Reel.tsx`.',
    '- **Inside a section, hard cuts** on downbeats or beats (half beats only in a fast run). The biggest picture change of a bar sits on its biggest musical moment (an accent, a crash, a stab).',
    "- **Three layers.** The kick drives a continuous background pulse: `const pulse = usePulse(kicks())`, then a scale of `1 + 0.02 * pulse`, a glow or a grid flash. The snare gives secondary accents (`usePulse(snares())` on a second element: a flicker, a shake). The melody brings elements in: take the scene's own notes, `const notes = eventsBetween(melody(0.8), bar(8), bar(12))`, then `usePopOn(notes, i)` pops element i (a word, a letter, a card, an icon, a shape) on the scene's i-th accented note; `useHitIndex(frames)` says which event the reel is past. These hooks and `useProgressAt(beat(n), beats(1))`/`useOvershootAt(beat(n))` take reel frames and work in any scene; `useProgress` and `useOvershoot` count from the scene's first frame, so never give them `beat()`.",
    '- Hold any text for at least one beat (except in the climax run); two beats for six words or more.',
    '- **The climax:** one word or one visual per beat (per half beat for a last run) for 1-2 bars, each in its own look.',
    '- **The end card** lands on the final hit and holds the last bar while the music fades (`<Music />` fades it for you).',
    '',
    '## Music',
    '',
    `The music is the reel's clock. It comes from the library, the user's own file, or you: \`${MOTION_MUSIC_TOOL}\` makes it the way the user picked (its \`engine\`). Then read \`music-map.md\` and \`public/reel.json\` again (bars, tempo and events change) and re-check timing that assumed the old grid.`,
    '',
    '- **Written in code (`engine: "code"`, free, recommended).** You write the music as a score and ReelMakeEasy renders it: kick, snare, hats, crash, sub bass, a triad pad, a pluck lead, arpeggios at peak energy, a riser and a fill into each big entry, and a final hit (tonic chord, crash, sub) on the last bar\'s downbeat with its ring-out. The harmony is kept consonant for you. Every hit is exactly where you put it: score it from your plan, one section per world.',
    "  - The sections' bars add up to the reel's bars at your tempo **less one** (the last bar is the final hit); the reply says the count if it is off.",
    '  - Energy is the arc: 0 ambient, 1 light, 2 full band, 3 peak (arpeggios, doubled lead). The lead plays its motif on every bar at energy 2-3 (alternate bars at 1): those notes are `melody()`, so pop elements on them. A launch reel: a short intro (1-2 bars at 1), a groove at 2, a one-bar "stop" (drums out, a held chord) right before the "drop" at 3 on your biggest reveal, and stay high to the end. Entries that climb two levels, and every drop, get a riser, a fill, a crash and a sub boom: put your biggest cuts there.',
    '  - `hits` add accents where the picture has a moment: "crash" (a cymbal and a kick), "hit" (kick, sub boom and snare: a slam), "stab" (a short chord). One or two per 4 bars at most; never on the bars the section entries already mark.',
    '  - Groove: "four" (kick on every beat: driving, 118-140 BPM), "backbeat" (kick 1 and 3, snare 2 and 4: punchy, 90-118), "half" (big and slow, under 90). Minor for tension and tech, major for warm and bright.',
    '  - Example (32 bars at 128 BPM, a 60 s launch): `{ "bpm": 128, "key": "D", "mode": "minor", "groove": "four", "sections": [{ "name": "intro", "bars": 2, "energy": 1 }, { "name": "build", "bars": 6, "energy": 2 }, { "name": "groove", "bars": 8, "energy": 2 }, { "name": "stop", "bars": 1, "energy": 0 }, { "name": "drop", "bars": 14, "energy": 3 }], "hits": [{ "bar": 11, "beat": 1, "kind": "hit" }, { "bar": 24, "beat": 3, "kind": "stab" }] }`.',
    '- **A music model (`engine: "eleven-music"` or `"ace-step"`, paid).** Write its prompt for this reel: genre, mood and instruments for the style and subject, a tempo in the style card\'s range, and its shape in bars (an intro that builds, a riser into a drop on the biggest moment, an ending that resolves). For a launch or a showreel: punchy drums, a clear hook, a real drop. One generation per request, never to try things. Its events are found by ear: check them in `music-map.md`.',
    '',
    '## Sound effects',
    '',
    'Place them with `<Sfx name="…" at={beat(n)} />`: one per transition or impact, never more than two on one frame, volume 0.4 to 0.8 under the music. A `riser` peaks on its frame (it starts two seconds earlier), so put it on the drop. The pack:',
    ...SFX_NAMES.map((name) => `- \`${name}\`: ${SFX_DESCRIPTIONS[name]}`),
    '',
    '## Craft rules',
    '',
    '- **Range.** At least 3 worlds in a 15 s reel, 4 in 30 s, 6 in 60 s. Mix techniques: kinetic type, particles forming a shape, shape morphs, a product UI rebuilt in code (cards dropping in, a chat box being typed, a chart drawing), depth (perspective, a tunnel, an orbit), fluid blobs, data viz, a logo build.',
    '- **Text sits on a visual.** Words are one short line over something visual, never the whole picture; never two text-only scenes in a row.',
    '- **Show the product working.** When the subject is a product, rebuild its UI in code (from the reference screenshots when the user gave its website) for at least one bar.',
    '- **Never still.** Something moves on every frame outside the end card; no stretch over one beat without motion. The kick pulse fades within half a beat and kicks can be bars apart (backbeat, half time, energy 0-1), so give every ground a constant drift too.',
    '- Keep text and key shapes inside a 6% safe margin. Measure long lines with `measureText`/`fitText` from `@remotion/layout-utils` instead of guessing sizes; nothing may run off the frame.',
    '- The smallest text is at least 3% of the frame height. A vertical (9:16) reel stacks what a wide one puts side by side (`isVertical` in grid.ts).',
    "- Stay inside the style's palette and fonts. Ease every move (`ease.snap`, `ease.glide`, `useOvershoot`); nothing moves linearly except constant drifts. Keep it deterministic: no `Math.random()` (use `random(seed)` from Remotion), no CSS transitions.",
    "- Use the subject from the brief for every word on screen; never copy a video reference's text, logo or footage.",
    '- Type-check with `npx tsc --noEmit` inside `reel/` when you change several files.',
    `- Never run \`remotion render\`, \`remotion still\` or \`npm install\` yourself: \`${MOTION_STILL_TOOL}\` and \`${MOTION_RENDER_TOOL}\` render for you, and everything you need is installed.`,
    '',
    '## The styles',
    '',
    ...MOTION_REEL_STYLES.map(
      (style) => `- **${style.label}** (\`${style.id}\`): ${style.description}`,
    ),
    '',
  ].join('\n')
}
