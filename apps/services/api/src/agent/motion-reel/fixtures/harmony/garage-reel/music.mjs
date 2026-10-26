// Test fixture (composer-harmony.test.ts): a 60 s garage score the owner liked, kept as it was written. B9, the 1.4
// bell and the F# 6/9 Picardy ending pass the harmony check; it still fails on the borrowed Dmaj7 (bVI, from the
// parallel minor) and the hook's G# over it (its #11), plus two non-chord tones of the motif. The test moves Dmaj7 to
// Amaj7 and the two motif statements onto chords that hold them (the skill's recipe A), and it passes.
// Sound: a UK garage / 2-step bed for a 60 s product showreel (M01, synth-native).
// The world sounds slick and nocturnal: swung hats, a skipping kick, minor-9 stabs, a bent bass.
// Key F# dorian (cool, hopeful minor; the raised 6th, D#, is the colour). Not a stock loop: i9 - IV9 - IIImaj7 - ii7,
// one surprise chord (bVImaj7, Dmaj7) at the second drop, a Picardy ending (F# major 6/9) = problem solved.
// Arc ARC-C two-drop: drop at bar 9 (~24 %), breakdown, bigger drop at bar 23 (~65 %), short resolve, ring ending.
// Motif (speech rhythm of "reel make ea-sy"): 5 notes, down a 4th by steps with one leap, answered on the tonic.
export default ({ config }) => ({
  bpm: config.bpm,
  meter: config.meter,
  key: 'F#',
  mode: 'dorian',
  seed: 136,

  swing: { hat: 0.58, shaker: 0.58, ghost: 0.58, default: 0.5 },

  voices: {
    kick: { inst: 'kick', f0: 140, f1: 46, decay: 0.28, click: 0.35, gain: 0.95, harmonics: -8 },
    snare: { inst: 'snare', body: 210, wires: 2200, decay: 0.07, mix: 0.55, gain: 0.55, send: 0.18 },
    clap: { inst: 'clap', tone: 1600, gain: 0.45, send: 0.25, minEnergy: 3 },
    ghost: { inst: 'rim', f1: 520, f2: 1800, gain: 0.25, pan: -0.2, human: { ms: 4, vel: 0.15 } },
    hat: { inst: 'hat', mode: 'metal', tone: 8200, gain: 0.32, pan: 0.25, choke: 'hh', human: { ms: 3, vel: 0.12 } },
    ohat: { inst: 'hat', mode: 'metal', open: true, decay: 0.09, gain: 0.22, pan: 0.3, choke: 'hh', minEnergy: 2 },
    shaker: { inst: 'shaker', gain: 0.18, swing: 0.5, pan: -0.35, minEnergy: 3, human: { ms: 5, vel: 0.2 } },

    // Bent garage bass: a saw bass with harmonics for phones, plus a pure sub under it.
    bass: { inst: 'sawBass', cut: 750, decay: 0.22, octave: 1, gain: 0.55, harmonics: -8, minEnergy: 2 },
    sub: { inst: 'sub', cut: 220, octave: 1, gain: 0.5, minEnergy: 2 },

    // Harmony: soft pad underneath, minor-9 stabs on the off-beats.
    pad: { inst: 'pad', cut: 1100, attack: 0.6, release: 0.9, detune: 9, chorus: 0.6, gain: 0.32, send: 0.45, voicing: 'close', center: 62, size: 4 },
    stab: { inst: 'stab', bright: 3200, dur: 0.22, gain: 0.38, send: 0.35, dsend: 0.2, voicing: 'close', center: 66, size: 4, minEnergy: 2 },
    keys: { inst: 'epiano', index: 1.3, tine: 0.6, decay: 0.7, trem: 0.2, gain: 0.42, send: 0.4, dsend: 0.25, octave: 5 },

    // The hook: a soft FM bell in the intro and break, a wide supersaw doubling it in the drops.
    bell: { inst: 'bell', ratio: 1.4, index: 1.6, decay: 0.5, gain: 0.45, send: 0.45, dsend: 0.3, octave: 5 },
    lead: { inst: 'supersaw', cut: 5200, hp: 250, attack: 0.008, release: 0.18, spread: 0.8, gain: 0.26, send: 0.3, dsend: 0.2, octave: 5, minEnergy: 3 },
    lead8: { inst: 'supersaw', cut: 6500, hp: 400, release: 0.15, spread: 1, gain: 0.14, send: 0.3, octave: 6, pan: 0.3, minEnergy: 4 },

    hiss: { inst: 'hiss', level: 0.006, tone: 7000, gain: 0.6 },
  },

  progression: ['F#m9', 'B9', 'Amaj7', 'G#m7'],
  chordBars: 1,
  progressionMode: 'section',

  motif: { degrees: [4, 2, 3, 1, 0], rhythm: 'x..x..x.x...x...', voice: 'bell' },

  grids: {
    // intro: no drums, the bell states the motif over the pad, a rim tick keeps time.
    air: { pad: 'hold', keys: { grid: 'C.......C.....x.', gate: 0.8 }, ghost: '..o...o...o...o.', kick: { grid: 'x...............', f0: 110, decay: 0.4 }, hiss: 'hold' },
    // build: the 2-step skeleton arrives, bass enters on the 2nd half.
    build: {
      pad: 'hold', kick: 'X.........x.....', snare: '....x.......x...', hat: '..x...x...x...x.',
      ghost: '.o.....o.o.....o', bass: { grid: 'R.........R.....', gate: 0.8 }, keys: { grid: '..C.....C.......', gate: 0.5 },
    },
    // drop A: skipping kick, swung 16th hats, off-beat stabs, the bass bends between root and octave.
    dropA: {
      pad: 'hold', kick: 'X......x..X.....', snare: '....X.......X...', hat: 'o.x.o.x.oox.o.xo', ohat: '......x.......x.',
      ghost: '.o.o...o.o..o..o', bass: { grid: 'R.....O...R..R..', gate: 0.85 }, sub: { grid: 'R.........R.....', gate: 0.9 },
      stab: { grid: '...x..x....x..x.', gate: 0.6 }, clap: '....x.......x...', shaker: 'xoxoxoxoxoxoxoxo',
    },
    // a 4th-bar variation: kick drops out on beat 3, stab answers.
    dropAfill: { kick: 'X......x........', stab: { grid: '...x..x.x.x.x.X.', gate: 0.5 }, hat: 'o.x.o.x.xxxxXxXx' },
    // breakdown: drums out, keys and the motif answer, sub only on the downbeat.
    brk: { pad: 'hold', keys: { grid: 'C.......C...C...', gate: 0.7 }, ghost: '..o.......o.....', sub: { grid: 'R...............', gate: 0.95 }, hiss: 'hold' },
    // lift: a snare roll builds into the second drop.
    lift: { pad: 'hold', snare: 'x...x...x.x.xxxx', hat: 'x.x.x.x.xxxxxxxx', kick: 'X...X...X...X...', sub: { grid: 'R...R...R...R...', gate: 0.6 } },
    // drop B: everything, a busier bass, the lead doubled an octave up.
    dropB: {
      pad: 'hold', kick: 'X......x..X..x..', snare: '....X.......X...', hat: 'o.x.oxx.oox.o.xo', ohat: '......x.......x.',
      ghost: '.o.o...o.o..o..o', bass: { grid: 'R..O..R...R.O.R.', gate: 0.8 }, sub: { grid: 'R.........R.....', gate: 0.9 },
      stab: { grid: '...x..x....x..x.', gate: 0.6 }, clap: '....x.......x...', shaker: 'xoxoxoxoxoxoxoxo',
    },
    dropBfill: { kick: 'X......x..X.....', snare: '....X.......X.xX', stab: { grid: '...x..x.x.x.x.X.', gate: 0.5 } },
    // outro: drums thin to the kick and hats, the pad carries into the final chord.
    outro: { pad: 'hold', kick: 'X.........x.....', hat: '..x...x...x...x.', ghost: '.o.....o.o.....o', sub: { grid: 'R...............', gate: 0.95 } },
    // final: the Picardy chord rings.
    final: { pad: 'hold', keys: { grid: 'C...............', gate: 1 }, sub: { grid: 'R...............', gate: 1 }, bell: { grid: 'x...............', notes: [7] } },
  },

  sections: [
    { name: 'intro', bars: 4, energy: 1, grid: 'air', motif: { voice: 'bell', every: 2 } },
    { name: 'build', bars: 4, energy: 2, grid: 'build', motif: { voice: 'keys', every: 2, bar: 1 }, fx: ['riser', 'gap16'] },
    { name: 'dropA', bars: 8, energy: 3, grid: 'dropA', fill: { grid: 'dropAfill', every: 4 }, motif: { voice: 'lead', every: 2 } },
    { name: 'break', bars: 4, energy: 1, grid: 'brk', prog: ['F#m9', 'B9', 'Dmaj7', 'C#m7'], motif: { voice: 'bell', transform: 'aug', every: 4 }, fx: ['downlifter'] },
    { name: 'lift', bars: 2, energy: 2, grid: 'lift', prog: ['Dmaj7', 'E'], fx: ['riser', 'gap8'] },
    { name: 'dropB', bars: 8, energy: 4, grid: 'dropB', fill: { grid: 'dropBfill', every: 4 }, prog: ['F#m9', 'B9', 'Dmaj7', 'G#m7'], motif: { voice: 'lead', every: 2 }, play: { lead8: 'motif' } },
    { name: 'outro', bars: 2, energy: 2, grid: 'outro', prog: ['Dmaj7', 'E'], motif: { voice: 'bell', transform: 'retro' } },
    { name: 'final', bars: 2, energy: 1, grid: 'final', prog: [[42, 49, 54, 58, 61, 63, 68]], chordBars: 2 },
  ],

  mix: {
    duck: { by: ['kick'], depth: 0.45, beats: 0.5, targets: ['music'] },
    reverb: { size: 0.82, damp: 0.35, wet: 0.8 },
    delay: { beats: 0.75, fb: 0.32, lp: 3200, wet: 0.8, spread: 1 },
    monoBelow: 120,
    width: 1.1,
  },
});
