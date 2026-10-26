import { SFX_DESCRIPTIONS, SFX_NAMES } from '@reelmakeeasy/common/motion-reel/sfx'

import { MUSIC_COMPOSER_SKILL_NAME } from './music-composer-skill'

export const MOTION_REEL_SKILL_NAME = 'reelmakeeasy-motion-reel'

/** The tools a Motion Reel chat has (agent-tools.ts implements them). */
export const MOTION_STILL_TOOL = 'motion_still'
export const MOTION_RENDER_TOOL = 'motion_render'
export const MOTION_MUSIC_TOOL = 'motion_music'
export const MOTION_SETUP_TOOL = 'motion_setup'

/**
 * The `reelmakeeasy-motion-reel` skill: the mechanics of a Motion Reel (what ReelMakeEasy sets up
 * in `reel/`, its helpers, the tools and the hard technical rules), never a creative method: that
 * comes from the reel's type and the user. ReelMakeEasy writes it into the agent's skills at every
 * session start; `skills/reelmakeeasy-motion-reel/SKILL.md` is the checked-in copy.
 */
export function renderMotionReelSkill(): string {
  return [
    '---',
    `name: ${MOTION_REEL_SKILL_NAME}`,
    'description: The mechanics of a ReelMakeEasy Motion Reel (a short motion-graphics video in Remotion, timed to its music), with its project files, helpers, tools and technical rules. Use in every Motion Reel chat, before planning, writing scenes, rendering or changing a reel.',
    '---',
    '',
    '# Motion Reels',
    '',
    "A Motion Reel is a short motion-graphics video written as a Remotion project in `reel/` and timed to its music on one clock, the beat grid. This skill covers the mechanics only. The creative method comes from the reel's type (in `brief.md`) and the user: you decide the look.",
    '',
    '## The project',
    '',
    `ReelMakeEasy sets the project up in \`reel/\`: before your first turn when the user filled in the setup card, or when you call \`${MOTION_SETUP_TOOL}\` in an Advanced chat (call it with no arguments first to list the reel types, lengths, frames and music). Either way you get:`,
    '- `reel/brief.md`: what the user asked for: the type (`launch`, a product launch, or `showreel`, a motion reel), subject, length, frame, music and reference.',
    '- `reel/music-map.md`: the music bar by bar, in beat numbers: its sections and energy, and where the kicks, snares, melody notes (accents marked) and chord changes fall.',
    "- `reel/public/reel.json`: size, frame rate, length in whole bars, tempo, the music's beats, bar starts and strongest hits, and its `events` (the music map's data), in seconds from the reel's first frame.",
    "- `reel/public/music.wav`: the music, already trimmed to the reel's bars (absent for a reel without music, which runs on a steady grid).",
    '- `reel/public/sfx/*.wav`: the sound pack (below).',
    "- `reel/public/reference/`: when the user gave a reference. A video: `contact-sheet.png` (16 frames of its opening) and `rhythm.json` (its cuts and how they sit on its beat); take its look and rhythm, never its content. A website: `site-1.png` to `site-3.png` (its home page, top to bottom) and `brand.json` (colours, fonts, headline); when it is the subject's own, its colours, words and screenshots may go in the reel (`<Img src={staticFile('reference/site-1.png')} />`).",
    '- `reel/src/grid.ts`, `reel/src/kit.tsx` and `reel/src/transitions.tsx`: the helpers below. ReelMakeEasy owns them and refreshes them: use them, never edit them. `reel/src/Reel.tsx` is a starter you replace; put your scenes and own helpers in `reel/src/scenes/`.',
    '- `reel/plan.md` is yours to write; the Tasks panel shows it to the user.',
    '',
    '## The plan',
    '',
    'Write `reel/plan.md` before you build: one line per scene with its beats or bars (`bar(2)` to `bar(4)`) and what is on screen. Then write the plan in your reply text too, not only in your thinking (the user sees neither your thinking nor the file): one short line per scene with its beats or bars. Only then ask whether to build it, below the plan in the same reply; never ask "Build this plan?" without the plan above it. When the user changes something, update `plan.md` and show the new plan again.',
    '',
    'Remotion is installed. Its own skills (`remotion-best-practices`, `remotion-markup`, `remotion-multimedia`) have its API in detail; where they differ, follow this skill (here ReelMakeEasy sets the project up and renders).',
    '',
    '## The helpers',
    '',
    '- **`grid.ts`, the clock.** `beat(n)` and `bar(n)` give the frame of beat or bar n (from 0); `beats(k)` and `bars(k)` give a length in frames. The music as frames: `kicks()`, `snares()`, `melody(minStrength)` (0.8 and up = accents), `chordChanges()`, `hitFrames()`, `sections()` (`{ name, energy, from, to }`), `sectionAt(frame)`, `eventsBetween(list, from, to)`, `beatOf(frame)`. Also `grid` (reel.json), `beatSec`, `frameAt(seconds)` and `isVertical`.',
    '- **`kit.tsx`, sound and motion.** `<Music />` plays `music.wav` and fades it at the end; `<Sfx name="…" at={beat(n)} />` plays a sound effect; `<Scene from={beat(n)} forBeats={k}>` is a plain sequence; `ease.snap`, `ease.glide` and `ease.anticipate` are the easings. `useProgress(start, frames)` and `useOvershoot(start)` count from the first frame of the scene; `useProgressAt(at, frames)`, `useOvershootAt(at)`, `useReelFrame()`, `usePulse(frames)` (1 on each event, easing to 0), `useHitIndex(frames)` (which event the reel is past) and `usePopOn(frames, i)` (element i pops on the i-th event) take reel frames, so they work in any scene.',
    '- **`transitions.tsx`, shots.** `<Shot from={bar(n)} to={bar(m)}>` places a scene; `exit` on the outgoing shot and the same `enter` and `direction` on the next give a transition (`"whip"`, `"zoom"`, `"wipe"`) that starts on the cut and takes `transitionBeats` (half a beat); put the incoming shot right after the outgoing one. `flash` on a shot, or `<Flash at={bar(n)} />` anywhere, is a 3-frame light flash. `whipIn`, `whipOut`, `zoomThrough`, `maskWipe` and `transitionStyle` are the same moves as CSS style objects.',
    '',
    'Time everything with these: never type a frame number or a duration in seconds.',
    '',
    '## The tools',
    '',
    `- \`${MOTION_SETUP_TOOL}\` (Advanced chats only): sets \`reel/\` up from the type, subject, length, frame, music and reference; with no arguments it lists the options. Calling it again keeps your scenes and plan.`,
    `- \`${MOTION_MUSIC_TOOL}\`: puts music you make under the reel, the way the user picked (its \`engine\`), and rewrites \`public/music.wav\` and \`public/reel.json\`. Then read \`music-map.md\` and \`reel.json\` again (bars, tempo and events change) and re-check timing that assumed the old grid.`,
    `  - \`engine: "composer"\` (free, recommended): read the \`${MUSIC_COMPOSER_SKILL_NAME}\` skill and follow it. You write \`music/music.mjs\`, set \`bpm\` in \`music/reel.config.mjs\`, run \`cd reel/music && node tools/score.mjs --no-cues\` in your shell, fix what its QC flags, then call \`${MOTION_MUSIC_TOOL}\` with \`engine: "composer"\` and no prompt. The sections add up to the reel's bars at your tempo, round(length x bpm / 240); the reply says the count if it is off. Its events are exact.`,
    '  - `engine: "eleven-music"` or `"ace-step"` (paid): pass a prompt (and a tempo). One generation per request, never to try things. Its events are found by ear: check them in `music-map.md`.',
    `- \`${MOTION_STILL_TOOL}\`: renders single frames at the beats you pass (at most 6) and gives them back as pictures; open each one and look at it. The user sees them too.`,
    `- \`${MOTION_RENDER_TOOL}\`: type-checks, renders the reel, evens out the loudness, shows it to the user and returns a sync report: how the picture sits on the music (cuts on the grid, section starts, accented melody notes, shot changes), with the beat of every miss, plus the kick pulse as information only (not required: a pulse on every kick of the whole reel reads as repetitive). When it fails, fix what it lists at the beats it names and render again: at most 3 renders, then say what is still off.`,
    '',
    '## Sound effects',
    '',
    'Place them with `<Sfx name="…" at={beat(n)} />` (volume 0.4 to 0.8 under the music). A `riser` peaks on its frame (it starts two seconds earlier). The pack:',
    ...SFX_NAMES.map((name) => `- \`${name}\`: ${SFX_DESCRIPTIONS[name]}`),
    '',
    '## Hard rules',
    '',
    '- Work only inside `reel/`. Images and logos only from `reel/public/`.',
    '- Keep it deterministic: no `Math.random()` (use `random(seed)` from Remotion), no `Date`, no CSS transitions or animations; every value comes from the frame.',
    `- Never run \`remotion render\`, \`remotion still\` or \`npm install\` yourself: \`${MOTION_STILL_TOOL}\` and \`${MOTION_RENDER_TOOL}\` render for you, and everything you need is installed.`,
    '- Fonts only through `@remotion/google-fonts`.',
    '- Keep text and key shapes inside a 6% safe margin; measure long lines with `measureText`/`fitText` from `@remotion/layout-utils`, so nothing runs off the frame.',
    "- Every word on screen comes from the brief's subject (or the subject's own website); never copy a video reference's text, logo or footage.",
    '- Type-check with `npx tsc --noEmit` inside `reel/` when you change several files.',
    '',
  ].join('\n')
}
