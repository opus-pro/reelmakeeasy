import { SFX_DESCRIPTIONS, SFX_NAMES } from '@reelmakeeasy/common/motion-reel/sfx'
import { MOTION_REEL_STYLES } from '@reelmakeeasy/common/motion-reel/styles'

export const MOTION_REEL_SKILL_NAME = 'reelmakeeasy-motion-reel'

/** The tools a Motion Reel chat has (agent-tools.ts implements them). */
export const MOTION_STILL_TOOL = 'motion_still'
export const MOTION_RENDER_TOOL = 'motion_render'
export const MOTION_MUSIC_TOOL = 'motion_music'
export const MOTION_SETUP_TOOL = 'motion_setup'

/**
 * The `reelmakeeasy-motion-reel` skill: how a Motion Reel is planned and built, on the music's beat
 * grid, in Remotion. ReelMakeEasy writes it into the agent's skills at every session start;
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
    'A Motion Reel is a short motion-graphics video (an intro, a launch, a showreel) written as a Remotion project and timed to its music. The music, the cuts and the sound effects all sit on one clock: the beat grid. A reel looks good when every cut, move and sound lands on it.',
    '',
    '## The project',
    '',
    `ReelMakeEasy sets the project up in \`reel/\`: before your first turn when the user filled in the setup card, or when you call \`${MOTION_SETUP_TOOL}\` in an Advanced chat (which has no card; call it with no arguments to list the styles and music first). Either way you get:`,
    '- `reel/brief.md`: what the user asked for (style, subject, length, ratio, music, reference).',
    '- `reel/style.md`: the chosen style card (look, type, motion, pacing and sound, build notes). Follow it.',
    "- `reel/public/reel.json`: size, frame rate, length in whole bars, tempo, and the music's beats, bar starts and strongest hits, in seconds from the reel's first frame.",
    "- `reel/public/music.wav`: the music, already trimmed to the reel's bars (absent for a reel without music).",
    '- `reel/public/sfx/*.wav`: the sound pack.',
    "- `reel/public/reference/`: when the user gave a reference. A video: `contact-sheet.png` (16 frames across its opening) and `rhythm.json` (its cut times, shot length and how its cuts sit on its own beat). Take its look and rhythm, never its content. A website: `site-1.png` to `site-3.png` (its home page, top to bottom) and `brand.json` (colours, fonts, headline). When the website is the subject's own, its colours, words and screenshots may go in the reel (`<Img src={staticFile('reference/site-1.png')} />`).",
    '- `reel/src/grid.ts` (the clock), `reel/src/kit.tsx` (music, sound effects, scenes, easings) and `reel/src/Reel.tsx` (a starter title you replace).',
    '',
    'Remotion is installed. Its own skills (`remotion-best-practices`, `remotion-markup`, `remotion-multimedia`) have its API in detail: read them when you need an API you are unsure of, but follow this skill where they differ (here ReelMakeEasy sets the project up and renders).',
    '',
    '## How to work',
    '',
    '1. **Read** `brief.md`, `style.md`, `public/reel.json`, and the reference files when there are any (open the images and look at them).',
    "2. **Plan in bars.** Write `reel/plan.md`: one line per scene with its bars and beats, what is on screen, what moves on which beat, and the sound effect on each cut. Size it to the reel's bars and the style's cut rhythm. Put the biggest moment on the strongest hit or a bar start, and end on a held title card in the last bar. Write the plan in your reply as one short line per scene (not the file itself, and not only in your thinking: the user can't see that), then ask if it's good, unless they already said to go ahead.",
    '3. **Build.** Write one component per scene in `reel/src/scenes/`, and place them in `Reel.tsx` with `<Sequence from={bar(n)} durationInFrames={bars(k)}>`. Fonts come from `@remotion/google-fonts` (the style card names them). Images and logos only from `reel/public/`.',
    `4. **Look.** Call \`${MOTION_STILL_TOOL}\` on the important frames (each scene's first beat and its busiest moment) and look at the images. Fix what is cut off, too small, crowded, off-palette or off-style before rendering.`,
    `5. **Render.** Call \`${MOTION_RENDER_TOOL}\`. It renders the reel, evens out the loudness, shows it to the user in the chat, and reports how many cuts land on the grid. When a cut misses, fix its timing and render again.`,
    '6. **Change it** when the user asks: edit the scene, look at a still, render again. Say what you changed in one line.',
    '',
    '## Timing rules (the clock)',
    '',
    '- Time everything with `beat(n)`, `bar(n)`, `beats(k)` and `bars(k)` from `grid.ts`. Never type a frame number or a duration in seconds.',
    '- Cuts land on bar starts or beats (half beats only in a deliberate stutter). Moves start on a beat and settle within it.',
    '- Hold any text for at least one beat; two beats for six words or more; the end card for the whole last bar.',
    "- `grid.strongHits` (via `hitFrames()`) are the music's accents: put impacts there.",
    '- The last bar holds the end card while the music fades (`<Music />` fades it for you).',
    '',
    '## Music',
    '',
    `The music is the reel's clock. It comes from the library, the user, or you: \`${MOTION_MUSIC_TOOL}\` composes a track with the user's music model (a paid generation; one per request, never to try things). Write its prompt for this reel: genre, mood, instruments and energy that suit the style and subject, a tempo in the style card's range, and its shape in bars (an intro that builds, a riser into a drop where the biggest moment goes, hits on the downbeats, an ending that resolves). For a launch or a showreel, make it exciting: punchy drums, a clear hook, a real drop. Then read \`public/reel.json\` again (the bars, tempo and hits change) and re-check timing that assumed the old grid.`,
    '',
    '## Sound effects',
    '',
    'Place them with `<Sfx name="…" at={beat(n)} />`: one per cut or impact, never more than two on one frame, volume 0.4 to 0.8 under the music. A `riser` peaks on its frame (it starts two seconds earlier), so put it on the drop. The pack:',
    ...SFX_NAMES.map((name) => `- \`${name}\`: ${SFX_DESCRIPTIONS[name]}`),
    '',
    '## Craft rules',
    '',
    '- Keep text and key shapes inside a 6% safe margin. Measure long lines with `measureText`/`fitText` from `@remotion/layout-utils` instead of guessing sizes; nothing may run off the frame.',
    '- The smallest text is at least 3% of the frame height. A vertical (9:16) reel stacks what a wide one puts side by side (`isVertical` in grid.ts).',
    "- Stay inside the style's palette and fonts. One idea per scene. Ease every move (`ease.snap`, `ease.glide`, `useOvershoot`); nothing moves linearly except constant drifts.",
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
