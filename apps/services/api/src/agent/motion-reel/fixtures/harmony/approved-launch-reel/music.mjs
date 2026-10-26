// Test fixture (composer-harmony.test.ts): the launch-reel score the owner APPROVED (score v3/v4), kept as it was
// written, with its cue sheet (cues.json). Must PASS with no issue: F# dorian, F#m9 - B9 - Amaj7 - G#m7, the 1.4 bell
// hook doubled by a supersaw, the F# 6/9 Picardy ending.
// ReelMakeEasy launch reel, score v3: liquid drum & bass at 176 BPM (felt 88), 22 bars = 30.0 s, on the same cue sheet.
// The harmony and sound palette of the owner's liked garage track: F# dorian, F#m9 - B9 - Amaj7 - G#m7, off-beat minor-9
// stabs, electric piano, a soft FM bell hook, a supersaw doubling in the drops, swung hats, rim ghosts, a shaker, a saw bass
// over a sine sub. Every pitched note belongs to the chord sounding at that moment (its 7th and 9th included), so nothing
// clashes; the kick is a normal punchy kick (fast pitch drop, short tail, no harmonics layer).

// pitch classes of each chord, root first
const CHORD = {
  'F#m9': [6, 9, 1, 4, 8],
  B9: [11, 3, 6, 9, 1],
  Amaj7: [9, 1, 4, 8],
  'G#m7': [8, 11, 3, 6],
  'F#69': [6, 10, 1, 3, 8],      // the end: F# major 6/9, as in the garage track's ending
};

// the chord of every bar (0-based), mirroring sections[]; the peak changes chord every half bar
const BARS = [
  'F#m9', 'F#m9',                          // hook, typing
  'F#m9', 'B9',                            // drop
  'F#m9', 'B9', 'Amaj7', 'G#m7',           // app
  'F#m9', 'B9',                            // stack
  'F#m9', 'B9', 'Amaj7', 'G#m7',           // rank
  'Amaj7', 'G#m7',                         // breakdown
  'F#m9', 'B9',                            // rebuild
  ['F#m9', 'B9'], ['Amaj7', 'G#m7'],       // peak (half bars)
  'F#69', 'F#69',                          // ring
];

/** The chord's tones (MIDI) inside [lo, hi], ascending. */
const tones = (name, lo, hi) => {
  const out = [];
  for (let m = lo; m <= hi; m++) if (CHORD[name].includes(m % 12)) out.push(m);
  return out;
};

export default ({ config, sheet, T }) => {
  const BAR = T.bar(1), BEAT = T.beat(1), STEP = T.s16(1);
  const cues = sheet?.cues ?? [];
  // cues sit a few ms either side of the grid: within 20 ms of a chord change they belong to the new chord
  const chordAt = t0 => {
    const t = t0 + 0.02;
    const b = Math.max(0, Math.min(BARS.length - 1, Math.floor(t / BAR + 1e-3)));
    const c = BARS[b];
    return Array.isArray(c) ? c[(t - b * BAR) >= BAR / 2 - 1e-3 ? 1 : 0] : c;
  };
  const top = (t, lo = 67, hi = 84) => tones(chordAt(t), lo, hi);
  // seconds until the chord changes (a held note never rings into the next chord)
  const untilChange = t0 => {
    const t = t0 + 0.02;
    const step = Array.isArray(BARS[Math.floor(t / BAR + 1e-3)]) ? BAR / 2 : BAR;
    let end = (Math.floor(t / step + 1e-3) + 1) * step;
    while (end < BARS.length * BAR - 1e-6 && chordAt(end) === chordAt(t)) end += BAR / 2;
    return Math.max(0.05, end - t0 - 0.01);
  };
  const ms = t => Math.round(t * 1000);
  const TICKED = new Set();

  // UI elements play the next tone of the chord, climbing (melody-as-UI)
  const UI = new Map();
  { let i = 0; for (const c of cues) if (c.kind === 'blip' && c.id !== 'copy' && c.id !== 'wordmark') { const ts = top(c.t, 73, 88); UI.set(ms(c.t), ts[i++ % ts.length]); } }

  // the hook: five notes in the garage track's rhythm (cells 0 3 6 8 12), falling through the chord's upper tones and
  // landing on its root, each one a tone of the chord under it
  const CELL = [0, 3, 6, 8, 12], LEN = [3, 3, 2, 4, 4];
  const notes = [];
  const hook = (voice, t0, { vel = 0.85, oct = 0, only } = {}) =>
    CELL.forEach((c, i) => {
      if (only && !only.includes(i)) return;
      const at = t0 + c * STEP, ts = top(at, 68, 81);
      const pick = [ts.length - 1, ts.length - 3, ts.length - 2, ts.length - 4, 0][i];
      notes.push({ voice, at, note: ts[Math.max(0, pick)] + 12 * oct, dur: Math.min(LEN[i] * STEP * 0.92, untilChange(at)), vel: i === 0 ? vel : vel * 0.85 });
    });
  hook('bell', 0, { vel: 0.8 });                                  // cold open: the bell alone over the pad
  hook('bell', BAR, { vel: 0.7, only: [0, 1, 2] });
  for (const b of [2, 3]) { hook('lead', b * BAR, { vel: 0.9 }); hook('bell', b * BAR, { vel: 0.5 }); }   // the drop
  for (const b of [10, 11, 12, 13]) hook('lead', b * BAR, { vel: 0.8 });                                  // ranking
  for (const b of [14, 15]) hook('bell', b * BAR, { vel: 0.7 });                                          // breakdown
  for (const b of [16, 17]) hook('lead', b * BAR, { vel: 0.85 });                                         // rebuild
  for (const b of [18, 19]) { hook('lead', b * BAR, { vel: 0.95 }); hook('lead8', b * BAR, { vel: 0.55, oct: 1 }); }   // peak
  // end card: the hook lands on F#, the bell rings the tonic
  hook('lead', 20 * BAR, { vel: 0.9, only: [0, 1, 2, 3] });
  notes.push({ voice: 'bell', at: 20 * BAR + 12 * STEP, note: 78, dur: 1.6, vel: 0.9 });

  const subRoot = t => 24 + ((CHORD[chordAt(t)][0] - 24 + 120) % 12) + 12;   // the root between C2 and B2
  // one play per pitch: in this composer a numeric `notes` array means scale degrees, not MIDI
  const chime = (api, t, o) => {
    const at = o.t ?? t, dur = Math.min(o.dur, untilChange(at));
    for (const note of o.notes ?? [o.note]) api.play('chime', { note, vel: o.vel, dur, t: at });
  };
  const hit = (api, t, vel = 0.9) => api.play('sub', { note: subRoot(t), dur: Math.min(0.6, untilChange(t)), vel, t });

  return {
    bpm: config.bpm, meter: config.meter, stepsPerBar: 16,
    key: 'F#', mode: 'dorian', seed: 176,
    swing: { hat: 0.56, shaker: 0.56, ghost: 0.56, default: 0.5 },
    humanize: { hat: { ms: 3, vel: 0.12 }, ghost: { ms: 4, vel: 0.15 }, shaker: { ms: 5, vel: 0.2 }, default: { ms: 0, vel: 0 } },

    voices: {
      // drums: a normal kick (fast pitch drop, short tail, beater click), snare, clap, rim ghosts, swung hats, shaker
      kick: { inst: 'kick', f0: 200, f1: 55, pitchTau: 0.008, decay: 0.1, click: 0.65, drive: 1.3, gain: 0.72 },
      snare: { inst: 'snare', body: 210, drop: 0.1, wires: 2400, decay: 0.08, mix: 0.6, gain: 0.5, send: 0.16 },
      clap: { inst: 'clap', tone: 1600, gain: 0.32, send: 0.25, minEnergy: 3 },
      ghost: { inst: 'rim', f1: 520, f2: 1800, decay: 0.014, gain: 0.18, pan: -0.2 },
      hat: { inst: 'hat', mode: 'metal', tone: 8400, gain: 0.24, pan: 0.25, choke: 'hh' },
      ohat: { inst: 'hat', mode: 'metal', open: true, decay: 0.08, gain: 0.15, pan: 0.3, choke: 'hh' },
      shaker: { inst: 'shaker', gain: 0.14, pan: -0.35, minEnergy: 3 },
      ride: { inst: 'ride', decay: 0.9, ping: 0.4, gain: 0.07, pan: -0.3, minEnergy: 4 },
      // low end: a saw bass on roots, octaves and fifths, a pure sine sub under it (no glides)
      bass: { inst: 'sawBass', cut: 720, decay: 0.22, octave: 1, gain: 0.42, harmonics: -8 },
      sub: { inst: 'sub', cut: 200, octave: 1, gain: 0.42, gate: 0.94 },
      // harmony: a soft pad, minor-9 stabs on the off-beats, electric piano
      pad: { inst: 'pad', cut: 1200, attack: 0.3, release: 0.8, detune: 9, chorus: 0.6, gain: 0.26, send: 0.45, voicing: 'close', center: 62, size: 4 },
      stab: { inst: 'stab', bright: 3200, dur: 0.18, gain: 0.3, send: 0.35, dsend: 0.2, voicing: 'close', center: 66, size: 4, minEnergy: 2 },
      keys: { inst: 'epiano', index: 1.3, tine: 0.6, decay: 0.7, trem: 0.2, gain: 0.34, send: 0.4, dsend: 0.25, voicing: 'close', center: 64, size: 4 },
      arp: { inst: 'pluck', decay: 0.12, index: 1.0, gain: 0.11, send: 0.3, dsend: 0.2, octave: 5, pan: 0.3 },
      // the hook: the soft FM bell, a supersaw doubling it in the drops, its octave in the peak
      bell: { inst: 'bell', ratio: 1.4, index: 1.6, decay: 0.5, gain: 0.4, send: 0.45, dsend: 0.3 },
      lead: { inst: 'supersaw', cut: 5200, hp: 250, attack: 0.008, release: 0.18, spread: 0.8, gain: 0.24, send: 0.3, dsend: 0.2 },
      lead8: { inst: 'supersaw', cut: 6500, hp: 400, release: 0.15, spread: 1, gain: 0.12, send: 0.3, pan: 0.3 },
      // UI sounds: the epiano, short, always a tone of the chord
      chime: { inst: 'epiano', index: 1.1, tine: 0.8, decay: 0.35, trem: 0, gain: 0.26, send: 0.35, dsend: 0.2 },
      hiss: { inst: 'hiss', level: 0.005, tone: 7000, gain: 0.6 },
    },

    progressionMode: 'section', chordBars: 1,
    progression: ['F#m9', 'B9', 'Amaj7', 'G#m7'],

    grids: {
      // cold open: pad, keys and the bell; a rim keeps time
      air: { pad: { hold: true, gain: 0.7 }, keys: { grid: 'C.......C.....x.', gate: 0.8 }, ghost: '..o...o...o...o.', hiss: 'hold' },
      // the drop: a liquid two-step break, off-beat stabs, the bass between root and octave
      drop: {
        pad: 'hold',
        kick: 'X.........x.....' + 'X.x.......x..x..',
        snare: '....X..o....X...' + '.o..X.......X.oo',
        clap: '....x.......x...',
        ghost: '..o....o.o...o..' + '..o..o...o...o..',
        hat: 'o.x.o.x.oox.o.xo' + 'o.x.oox.o.x.o.xx',
        ohat: '......x.......x.',
        shaker: 'xoxoxoxoxoxoxoxo',
        bass: { grid: 'R.....O...R..R..', gate: 0.85 },
        sub: { grid: 'R_________R_____', gate: 0.9 },
        stab: { grid: '...x..x....x..x.', gate: 0.6 },
      },
      // the app (lighter): keys comp, a lighter break
      app: {
        pad: { hold: true, gain: 0.8 },
        kick: { grid: 'X.........x.....' + 'X.........x..x..', gain: 0.85 },
        snare: { grid: '....x.......x...' + '....x.......x..o', gain: 0.85 },
        ghost: '.o.....o.o.....o',
        hat: { grid: '..x...x...x...x.' + 'o.x...x.o.x...xo', gain: 0.85 },
        bass: { grid: 'R.........R..5..', gate: 0.8 },
        sub: { grid: 'R_________R_____', gain: 0.75 },
        keys: { grid: '..C.....C.....C.', gate: 0.6 },
      },
      // the layer stack: instruments arrive with the layers (keys, arp, bass, then the kit)
      stack: {
        pad: 'hold',
        keys: '..C.....C.....C.' + '..C..C..C..C..C.',
        arp: { grid: '....x.x.x.x.x.x.' + 'x.x.x.x.x.x.x.x.', notes: 'up', arpOctaves: 2 },
        bass: '............R...' + '..R...O...R..R..',
        sub: '............R___' + '....R_____R_____',
        hat: '................' + 'o.x.o.x.o.x.ooxx',
        kick: '................' + '....X.....x.....',
        snare: '................' + '........X...X.XX',
      },
      // ranking: the full groove with stabs and shaker
      rank: {
        pad: { hold: true, gain: 0.75 },
        kick: 'X.........x.....' + 'X.....x...x..x..',
        snare: '....X.......X...' + '....X..o....X.o.',
        clap: '....x.......x...',
        ghost: '.o....o..o....o.' + '.o..o.....o..o..',
        hat: 'o.x.oox.o.x.o.xx' + 'o.x.o.x.oox.o.xo',
        ohat: '......x.........' + '..............x.',
        shaker: 'xoxoxoxoxoxoxoxo',
        bass: { grid: 'R.....O...R..R..', gate: 0.85 },
        sub: { grid: 'R_________R_____', gate: 0.9 },
        stab: { grid: '...x..x....x..x.', gate: 0.6 },
      },
      // breakdown: drums out, keys and the bell, the sub on the downbeat
      brk: {
        pad: 'hold',
        keys: { grid: 'C.......C...C...', gate: 0.7 },
        ghost: '..o.......o.....',
        sub: { grid: 'R_______________', gain: 0.7 },
        hiss: 'hold',
      },
      // rebuild: the groove returns with a snare roll into the peak
      rebuild: {
        pad: 'hold',
        kick: 'X.........x.....' + 'X.x.......x.....',
        snare: '....X..o....X...' + '....X...x.x.xxxx',
        ghost: '..o....o.o...o..',
        hat: { grid: 'o.x.o.x.o.x.oox.' + 'oxx.o.x.oox.oxxx', gain: 0.85 },
        bass: { grid: 'R.....O...R..R..', gate: 0.85 },
        sub: { grid: 'R_________R_____', gain: 0.8 },
        stab: { grid: '...x..x....x..x.', gate: 0.6 },
      },
      // peak: everything, ride, busier bass, stabs
      peak: {
        pad: { hold: true, gain: 1.1 },
        kick: 'X.........x..x..' + 'X.x.......x.....',
        snare: { grid: '....X..o....X...' + '....X..o....Xo..', gain: 1.1 },
        clap: '....x.......x...',
        ghost: '..o....o.o...o..' + '..o..o...o...o..',
        hat: 'o.x.oox.oox.o.xx' + 'o.x.oox.o.x.ox..',
        ohat: '......x.......x.',
        ride: 'x.x.x.x.x.x.x.x.' + 'x.x.x.x.x.x.x...',
        shaker: 'xoxoxoxoxoxoxoxo',
        bass: { grid: 'R...O...R...O.5.' + 'R...O...R...O...', gate: 0.8 },
        sub: { grid: 'R_______R_______' + 'R_______R_____..', gain: 1.05 },
        stab: { grid: '...x..x....x..x.', gate: 0.6 },
        arp: { grid: 'x.x.x.x.x.x.x.x.', notes: 'updown', arpOctaves: 2, gain: 0.8 },
      },
      // the end card: the F# 6/9 chord rings on pad and keys, the sub holds the root
      ring: { pad: { hold: true, gain: 1.0 }, keys: { grid: 'C...............', gate: 1 }, sub: { grid: 'R_______________' + '________________', gain: 0.8 } },
    },

    sections: [
      { name: 'hook', bars: 1, energy: 0, prog: ['F#m9'], grid: 'air' },
      { name: 'typing', bars: 1, energy: 1, prog: ['F#m9'], grid: 'air',
        fx: [{ kind: 'filter', type: 'lp', bar: 0, bars: 1, f0: 700, f1: 3000, bus: 'music' }] },
      { name: 'drop', bars: 2, energy: 3, grid: 'drop', prog: ['F#m9', 'B9'] },
      { name: 'app', bars: 4, energy: 2, grid: 'app', prog: ['F#m9', 'B9', 'Amaj7', 'G#m7'] },
      { name: 'stack', bars: 2, energy: 3, grid: 'stack', prog: ['F#m9', 'B9'] },
      { name: 'rank', bars: 4, energy: 3, grid: 'rank', prog: ['F#m9', 'B9', 'Amaj7', 'G#m7'] },
      { name: 'breakdown', bars: 2, energy: 1, grid: 'brk', prog: ['Amaj7', 'G#m7'],
        fx: [{ kind: 'filter', type: 'lp', bar: 0, bars: 2, f0: 2600, f1: 900, bus: 'music' }] },
      { name: 'rebuild', bars: 2, energy: 3, grid: 'rebuild', prog: ['F#m9', 'B9'], fx: ['riser'] },
      { name: 'peak', bars: 2, energy: 4, grid: 'peak', prog: ['F#m9', 'B9', 'Amaj7', 'G#m7'], chordBars: 0.5 },
      { name: 'ring', bars: 2, energy: 1, grid: 'ring', prog: [[42, 49, 54, 58, 61, 63, 68]], chordBars: 2 },
    ],

    notes,

    fx: [
      { kind: 'gap', at: 13 * BAR - STEP, dur: STEP, bus: 'all' },
      { kind: 'gap', at: 20 * BAR - STEP, dur: STEP, bus: 'all' },
    ],

    cues: {
      key: (c, api) => api.inst('key', { f: 2400, thock: 0.22, decay: 0.006, gain: 0.38 * (c.g ?? 1), pan: -0.15 + 0.3 * api.rand() }),
      tick: (c, api) => {
        if (/^click|^send/.test(c.id ?? '')) { api.inst('key', { f: 2000, thock: 0.3, gain: 0.42 * (c.g ?? 1) }); return; }
        if (c.id === 'odometer-roll') { const k = ms(c.t); if (TICKED.has(k)) return; TICKED.add(k); api.inst('tick', { f: 4200, gain: 0.22 }); return; }
        api.inst('tick', { f: 3800, gain: 0.28 * (c.g ?? 1) });
      },
      blip: (c, api) => {
        let n = UI.get(ms(c.t));
        if (n == null || c.id === 'copy' || c.id === 'wordmark') { const ts = top(c.t, 73, 85); n = ts[ts.length - 1]; }
        const vel = (c.id === 'answer-check' ? 0.5 : c.id === 'card-option' ? 0.45 : 0.7) * (c.g ?? 1);
        chime(api, c.t, { note: n, vel, dur: 0.35 });
      },
      bell: false,
      boom: (c, api) => { hit(api, c.t, 0.95); chime(api, c.t, { notes: top(c.t, 61, 76), vel: 0.7, dur: 0.9 }); },
      lock: (c, api) => {
        if (c.id === 'odometer-land') { const ts = top(c.t, 78, 90); chime(api, c.t, { notes: [ts[0], ts[1]], vel: 0.4, dur: 0.5 }); return; }
        hit(api, c.t, 0.75); chime(api, c.t, { notes: top(c.t, 63, 76), vel: 0.7, dur: 0.8 });
      },
      burst: (c, api) => {
        if (c.id === 'explode') { chime(api, c.t, { notes: top(c.t, 61, 73), vel: 0.55, dur: 0.6 }); return; }
        hit(api, c.t, 0.9); chime(api, c.t, { notes: top(c.t, 61, 76), vel: 0.8, dur: 0.9 });
      },
      cut: (c, api) => {
        if (c.rank) {
          const ts = top(c.t, 73, 85), n = c.rank === 1 ? ts[ts.length - 1] : ts[(5 - c.rank) % ts.length];
          chime(api, c.t, { notes: [n, n + 12], vel: c.rank === 1 ? 0.9 : 0.65, dur: 0.5 });
          if (c.rank === 1) hit(api, c.t, 0.85);
          return;
        }
        chime(api, c.t, { notes: top(c.t, 66, 78), vel: 0.6, dur: 0.6 });
      },
      pop: (c, api) => {
        const ts = top(c.t, 73, 90);
        if (c.id === 'wave') { ts.slice(0, 4).forEach((n, k) => chime(api, c.t, { note: n, vel: 0.3 + 0.1 * k, dur: 0.25, t: c.t + k * STEP / 2 })); return; }
        chime(api, c.t, { note: ts[ts.length - 1], vel: 0.35 + (c.s ?? 0.2), dur: 0.3 });
      },
      snap: (c, api) => {
        if (c.id === 'snare-roll') { (c.t > 17.5 ? [0, 1] : [0, 1, 2, 3]).forEach(k => api.play('snare', { t: c.t + k * STEP / 2, vel: 0.22 + 0.13 * k })); return; }
        chime(api, c.t, { notes: top(c.t, 69, 81).slice(0, 2), vel: 0.55, dur: 0.35 });
      },
      final: (c, api) => { hit(api, c.t, 0.9); chime(api, c.t, { notes: [54, 61, 66, 70, 73], vel: 0.75, dur: 2.2 }); },
      sweep: (c, api) => api.inst('whoosh', { dur: c.d, dir: 1, lo: 400, hi: 2600, gain: 0.16 }),
      whoosh: (c, api) => api.inst('whoosh', { dur: c.d, dir: c.t < 6 ? -1 : 1, lo: 380, hi: 2600, gain: 0.28 }),
      reverse: false, flash: false, transition: false,
    },

    mix: {
      duck: { by: ['kick', 'boom', 'final'], depth: 0.42, beats: 0.5, targets: ['music'] },
      reverb: { size: 0.8, damp: 0.38, wet: 0.75 },
      reverbBus: { beat: 0.5, music: 1, sfx: 0.9 },
      delay: { beats: 0.75, fb: 0.3, lp: 3400, wet: 0.7, spread: 1 },
      hp: 28, monoBelow: 130, width: 1.1,
    },
  };
};
