import type { SfxName } from './sfx'

/**
 * Motion Reel's style library: nine looks a reel can be built in. Each card has the five parts the
 * agent follows (look, type, motion, pacing and sound, build notes) plus what the setup card and
 * the thumbnails need. Written from our own study of what makes short motion-design reels work;
 * the agent copies a look, never a reference's content.
 */

export type MotionReelRatio = '1:1' | '9:16' | '16:9'

export type MotionReelStyle = {
  /** How it's built in Remotion: the techniques that make this look work. */
  build: string[]
  /** Cuts per bar on average (2 = a cut every other beat); the finale may double it. */
  cutsPerBar: number
  description: string
  /** Google Fonts families (as @remotion/google-fonts names them): display, text, label. */
  fonts: { display: string; label: string; text: string }
  id: MotionReelStyleId
  label: string
  look: string
  motion: string
  /** Music to pick or make for it. */
  music: string
  /** Background first, then text, then accents (hex). */
  palette: string[]
  ratios: MotionReelRatio[]
  sfx: SfxName[]
  tempo: { max: number; min: number }
  type: string
}

export const MOTION_REEL_STYLE_IDS = [
  'hud-showreel',
  'kinetic-type',
  'product-ui-launch',
  'data-story',
  'bauhaus-shapes',
  'dark-precision',
  'glass-neon',
  'minimal-keynote',
  'retro-pixel',
] as const
export type MotionReelStyleId = (typeof MOTION_REEL_STYLE_IDS)[number]

const ALL_RATIOS: MotionReelRatio[] = ['16:9', '9:16', '1:1']

export const MOTION_REEL_STYLES: readonly MotionReelStyle[] = [
  {
    build: [
      'A HUD layer on top of every scene: four corner brackets, a top label, a running timecode and a "BAR n/N" counter that changes on each downbeat.',
      'Full-bleed colour cards cut hard on downbeats; never crossfade between them.',
      'Display words enter with a 4-6 frame snap (translateY + scaleY stretch + blur that clears), one word per beat.',
      'A single dot is the motif: it lands with an overshoot spring, pulses on beats, bursts into rays or morphs into the next shape.',
      'A pattern field (dot grid or tiles) that ripples in colour waves, one wave per beat.',
      'End on a held title card on the last bar while the music fades.',
    ],
    cutsPerBar: 1,
    description: 'A designer showreel: bold colour cards inside a viewfinder HUD, cut on the beat.',
    fonts: { display: 'ArchivoBlack', label: 'JetBrainsMono', text: 'InstrumentSerif' },
    id: 'hud-showreel',
    label: 'HUD Showreel',
    look: 'Full-bleed colour cards in near-black, cream, vermilion and electric blue. Flat 2D, dot particles and pattern fields. A viewfinder HUD frames every scene: corner brackets, timecode, tempo and bar counter.',
    motion:
      'Snappy overshoot easing, a dot morphing into shapes, colour waves rippling through a dot grid, hard colour-block cuts, a half-beat stutter before the finale.',
    music: 'Tight minimal electronic, four-on-the-floor kick, crisp hats, short synth stabs.',
    palette: ['#0b0b0d', '#f1ece1', '#f04a35', '#2f35f5'],
    ratios: ALL_RATIOS,
    sfx: ['tick', 'hit', 'whoosh', 'glitch', 'riser', 'shimmer'],
    tempo: { max: 132, min: 118 },
    type: 'Heavy grotesk caps that fill the frame, a light serif italic subtitle, tiny monospaced HUD labels.',
  },
  {
    build: [
      'Every beat is a new word or phrase; size each to fill 70-90% of the frame width (measure, never guess).',
      'Repeat the key word as outline-only type in rows behind it, scrolling sideways at a steady speed.',
      'Masks and wipes reveal words (clip-path on the beat), plus quick scale punches on the downbeats.',
      'Two colours only, inverted on each bar start.',
    ],
    cutsPerBar: 4,
    description: 'Words as the visuals: giant type punching in on every beat.',
    fonts: { display: 'Anton', label: 'SpaceMono', text: 'Inter' },
    id: 'kinetic-type',
    label: 'Kinetic Type',
    look: 'Two colours, giant condensed words filling the frame, rows of repeated outline type behind them.',
    motion:
      'A cut or word on every beat, mask wipes, scale punches on the downbeats, sideways scrolling type.',
    music: 'Punchy electronic or trap with a hard kick; hits on every beat.',
    palette: ['#111111', '#ff5a1f', '#f5f2ea'],
    ratios: ALL_RATIOS,
    sfx: ['hit', 'swish', 'tick', 'sub-drop'],
    tempo: { max: 150, min: 128 },
    type: 'Tall condensed display caps, very tight tracking; one small sans line at most.',
  },
  {
    build: [
      "Rebuild the product's interface as clean HTML/CSS cards (don't screenshot-and-zoom unless the setup gave screenshots).",
      'A visible cursor moves on a smooth path, presses (scale 0.9 on the beat) and things react on the next beat.',
      'Camera moves are slow zooms and pans over the UI (transform on a wrapper), one per two bars.',
      'Soft drop shadows, rounded corners, a light background; one accent colour for the key action.',
      'Feature callouts: a short label slides in beside the UI element it names.',
    ],
    cutsPerBar: 0.5,
    description:
      'An app launch: the product UI, a cursor, smooth zooms and short feature callouts.',
    fonts: { display: 'Inter', label: 'Inter', text: 'Inter' },
    id: 'product-ui-launch',
    label: 'Product UI Launch',
    look: 'A light, clean app interface: white cards, thin grey borders, soft shadows, one accent colour. A visible cursor.',
    motion:
      'Smooth zooms and pans across the UI, cursor clicks that trigger changes on the beat, feature labels sliding in.',
    music: 'Warm minimal electronic or light piano-electronic, unhurried.',
    palette: ['#f6f7f9', '#111318', '#4f6bff', '#e7e9ee'],
    ratios: ALL_RATIOS,
    sfx: ['click', 'pop', 'swish', 'shimmer'],
    tempo: { max: 116, min: 96 },
    type: 'One clean sans throughout: a medium-weight headline, small UI labels.',
  },
  {
    build: [
      "Numbers count up with an eased run that lands on a downbeat (tabular figures so digits don't jitter).",
      'Charts draw on: bars grow one per beat, lines draw with a stroke-dashoffset animation, rings fill.',
      'Every number has a short label and a source line in small type.',
      'One accent colour marks the key figure; everything else is ink on paper or paper on ink.',
    ],
    cutsPerBar: 0.5,
    description: 'An infographic reel: big numbers counting up, charts drawing on to the beat.',
    fonts: { display: 'Inter', label: 'IBMPlexMono', text: 'Inter' },
    id: 'data-story',
    label: 'Data Story',
    look: 'Big numbers, bar and line charts, progress rings, on a light paper or deep ink background, one accent colour.',
    motion:
      'Counters running up, bars growing one per beat, lines drawing on, rings filling, smooth slides between figures.',
    music: 'Modern electronic, steady and confident.',
    palette: ['#f1efe9', '#14161a', '#ff4f2e', '#2f6bff'],
    ratios: ALL_RATIOS,
    sfx: ['tick', 'click', 'whoosh', 'pop'],
    tempo: { max: 120, min: 100 },
    type: 'Heavy tabular numerals, a medium sans for labels, monospaced small print for units and sources.',
  },
  {
    build: [
      'Compose with a visible grid; shapes snap to grid lines.',
      'Use @remotion/shapes and SVG paths: circles, squares, triangles, quarter-circles that morph into each other.',
      'Shapes enter on the beat with an overshoot spring and rotate in 90° steps.',
      'Primary colours on cream; never more than four colours in a frame.',
    ],
    cutsPerBar: 2,
    description: 'Flat geometric shapes in primary colours, morphing and snapping on a grid.',
    fonts: { display: 'Syne', label: 'SpaceMono', text: 'Syne' },
    id: 'bauhaus-shapes',
    label: 'Bauhaus Shapes',
    look: 'Flat primary-colour shapes on cream, a visible grid, bold geometric compositions.',
    motion:
      'Shapes pop in on the beat, rotate in quarter turns, morph into one another and slide along grid lines.',
    music: 'Minimal beat-driven electronic with tight percussive hits.',
    palette: ['#f2ead8', '#1d1d1b', '#e63b2e', '#2558c9', '#f5c518'],
    ratios: ALL_RATIOS,
    sfx: ['pop', 'click', 'swish', 'tick'],
    tempo: { max: 128, min: 112 },
    type: 'A geometric sans for words, used sparingly; shapes carry the frame.',
  },
  {
    build: [
      'Black background, hairline rules (1-2 px) that draw across the frame on the beat.',
      'Text reveals letter by letter or with a slow mask, never bouncing.',
      'Every cut gets a tick; chapters are numbered (01, 02...) in small mono type.',
      'Light leaks or a soft glow on one element at most; restraint is the style.',
    ],
    cutsPerBar: 1,
    description: 'Calm and exact: black, hairlines, mono labels and a click on every cut.',
    fonts: { display: 'Inter', label: 'JetBrainsMono', text: 'Inter' },
    id: 'dark-precision',
    label: 'Dark Precision',
    look: 'Black, hairline rules, small monospaced labels, numbered chapters, one soft glow.',
    motion:
      'Slow precise reveals, lines drawing across the frame, measured cuts with a tick on each.',
    music: 'Deep ambient electronic with a soft pulse.',
    palette: ['#050506', '#e8e6e1', '#7d7f86', '#c8ff4a'],
    ratios: ALL_RATIOS,
    sfx: ['tick', 'click', 'sub-drop', 'shimmer'],
    tempo: { max: 104, min: 88 },
    type: 'A light sans for statements, monospaced labels and chapter numbers.',
  },
  {
    build: [
      'Dark gradient background with large soft colour blobs drifting slowly (blurred divs).',
      'Frosted-glass cards: semi-transparent fills, backdrop blur, a 1 px light border and an inner highlight.',
      'Glows on accents (text-shadow / box-shadow in the accent colour), animated on the beat.',
      'Cards slide in with depth (scale + translateZ feel) and settle with a soft spring.',
    ],
    cutsPerBar: 1,
    description: 'A sleek SaaS promo: frosted-glass cards and neon glow on a dark gradient.',
    fonts: { display: 'SpaceGrotesk', label: 'SpaceMono', text: 'Inter' },
    id: 'glass-neon',
    label: 'Glass & Neon',
    look: 'A dark gradient with drifting colour blobs, frosted-glass cards, neon accents and glows.',
    motion:
      'Cards sliding in with depth, glows pulsing on the beat, slow camera drift, headline scenes rising.',
    music: 'Deep pulsing synth, sleek and rising.',
    palette: ['#07071a', '#f1f3ff', '#7c5cff', '#22d3ee'],
    ratios: ALL_RATIOS,
    sfx: ['whoosh', 'shimmer', 'swish', 'riser'],
    tempo: { max: 124, min: 100 },
    type: 'A modern grotesk for headlines, a clean sans for body text.',
  },
  {
    build: [
      'One statement per two bars, centred, generous empty space; nothing else in the frame.',
      'Words fade and rise slightly (8-12 px), never bounce; the product appears as one hero image.',
      'Cuts only on bar starts; a pure white or pure black background that switches once at most.',
      'End on the product name and one line.',
    ],
    cutsPerBar: 0.5,
    description: 'Keynote restraint: one big statement at a time and lots of white space.',
    fonts: { display: 'Inter', label: 'Inter', text: 'Inter' },
    id: 'minimal-keynote',
    label: 'Minimal Keynote',
    look: 'Pure white (or black), one centred statement or one hero image at a time, lots of space.',
    motion: 'Gentle fades and small rises, a slow push on the hero image, cuts only on bar starts.',
    music: 'Sparse minimal piano, dry and confident.',
    palette: ['#ffffff', '#111111', '#86868b'],
    ratios: ALL_RATIOS,
    sfx: ['tick', 'swish', 'shimmer'],
    tempo: { max: 96, min: 76 },
    type: 'A semibold sans for statements with tight tracking, a grey sans for the second line.',
  },
  {
    build: [
      'Pixel art drawn on a small canvas grid (e.g. 64×36 cells) scaled up with image-rendering: pixelated.',
      'Or a synthwave scene: a perspective grid scrolling towards the viewer, a sun with scanline stripes.',
      'Pixel fonts, hard step animations (animate in whole cells, 8-12 fps feel on characters), scanlines over everything.',
      'Glitch stutters on cuts: offset RGB channels for 2-3 frames.',
    ],
    cutsPerBar: 2,
    description: 'Retro: pixel art or a synthwave grid, with chiptune energy.',
    fonts: { display: 'PressStart2P', label: 'VT323', text: 'VT323' },
    id: 'retro-pixel',
    label: 'Retro Pixel',
    look: 'Pixel art or a synthwave perspective grid with a striped sun, scanlines, saturated neon on dark.',
    motion:
      'Stepped pixel animation, the grid scrolling towards the viewer, RGB-split glitches on cuts.',
    music: 'Chiptune or driving synthwave.',
    palette: ['#120624', '#ff2e97', '#2de2e6', '#f6f740'],
    ratios: ALL_RATIOS,
    sfx: ['glitch', 'pop', 'hit', 'tick'],
    tempo: { max: 150, min: 120 },
    type: 'A blocky pixel font for titles, a terminal-style pixel font for text.',
  },
]

export function motionReelStyle(id: string): MotionReelStyle | undefined {
  return MOTION_REEL_STYLES.find((style) => style.id === id)
}

/** The style as the five-part card the agent reads. */
export function renderStyleCard(style: MotionReelStyle): string {
  return [
    `# ${style.label}`,
    '',
    style.description,
    '',
    `**Look:** ${style.look}`,
    '',
    `**Type:** ${style.type} Fonts: ${style.fonts.display} (display), ${style.fonts.text} (text), ${style.fonts.label} (labels), from @remotion/google-fonts.`,
    '',
    `**Motion:** ${style.motion}`,
    '',
    `**Pacing and sound:** about ${formatCutsPerBar(style.cutsPerBar)}; music: ${style.music} (${style.tempo.min}-${style.tempo.max} BPM). Sound effects: ${style.sfx.join(', ')}.`,
    '',
    `**Palette:** ${style.palette.join(', ')}`,
    '',
    '**Build notes:**',
    ...style.build.map((line) => `- ${line}`),
  ].join('\n')
}

function formatCutsPerBar(cutsPerBar: number): string {
  if (cutsPerBar >= 4) return 'a cut on every beat'
  if (cutsPerBar >= 2) return 'a cut every other beat'
  if (cutsPerBar >= 1) return 'a cut on every bar start'
  return `a cut every ${Math.round(1 / cutsPerBar)} bars`
}
