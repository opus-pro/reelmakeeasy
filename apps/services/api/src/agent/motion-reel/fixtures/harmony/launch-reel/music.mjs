// Test fixture (composer-harmony.test.ts): the dissonant launch-reel score that led to the harmony check. Must FAIL.
// ReelMakeEasy launch reel: score for THIS reel (PLAN.md ## Sound). Liquid drum & bass (M02, synth-native) at 176 BPM,
// felt 88 half-time, 22 bars = 30.0 s, Eb: aeolian cold open, lydian from the drop.
// The world: a glassy, fast groove that grows out of someone typing. The keyboard is the first drum (keycap clicks =
// the one foreign element, the product's own input), the screen's glass is every UI sound (one material palette:
// a phone-sized glass panel struck by a fingertip, pitched into the chord), and the track only exists once the
// agent starts making. Sync device: melody-as-UI (each card / chip / layer / node the agent shows plays the NEXT
// note of the motif), call and response inside the chat (user click = keycap asks, agent card = glass answers),
// typing as drums in the cold open, filter = focus in the breakdown, assembly in the layer stack.
// Motif: cryptogram of "MAKE" -> degrees 5 7 3 4 (Eb lydian C5 Eb5 A4 Bb4: up a minor 3rd, the one leap down a
// tritone onto the lydian A natural, a step back up; ends off the tonic = a question). Minor version (aeolian, same
// degrees) Cb5 Eb5 Ab4 Bb4 = the cold open's problem. Answer (end card only): + Eb5.
// Rhythm long-short-short-long: cells 0 6 10 12 of a 16-cell bar.
// Harmony: Ebm9 pedal (cold open) -> Ebmaj9 | F/Eb | Gm7/Eb | Ebmaj7#11 over an Eb pedal (upper voice moves) ->
// breakdown Cm9 | Bbsus4 -> peak per half-bar with ONE surprise chord, Cbmaj7 (bVI borrowed from the minor) ->
// F/Eb -> Eb6/9#11 ringing (minor problem -> lydian answer).
// Not the owner's liked 60 s track: different world (DnB, not garage), tempo (176 vs 136), key/mode (Eb lydian vs
// F# dorian), lead timbre (FM glass, not bell + supersaw), drums (two-step break), arc (ARC-A, not ARC-C), sync device
// (melody-as-UI). Kept from it (2/7 at most, by method only): a two-layer bass with harmonics for phones, data-only grids.
import { plateHz, OBJECT_MATERIALS } from './tools/audio/instruments.mjs';

// objects of the product's world (music-direction.md §7): sizes are the sounds
const KEYCAP_HZ = plateHz({ a: 0.018, b: 0.018, h: 0.0012, material: 'abs' });   // an 18 mm ABS keycap, ~5.3 kHz plate mode
const SCREEN_ASPECT = 147 / 71;                                                   // a phone's glass panel, 147 x 71 mm

// motif in MIDI (lydian / aeolian), cells and lengths of its long-short-short-long rhythm
const LYD = [72, 75, 69, 70], MIN = [71, 75, 68, 70], CELL = [0, 6, 10, 12], LEN = [6, 4, 2, 4];

export default ({ config, sheet, T }) => {
  const BAR = T.bar(1), BEAT = T.beat(1), STEP = T.s16(1);
  const cues = sheet?.cues ?? [];
  const ms = t => Math.round(t * 1000);
  const TICKED = new Set();               // the sheet doubles some odometer ticks: one glass tick per instant

  // ---------------------------------------------------------------- melody-as-UI: every agent element = next motif note
  // (cards, chips, checks, storyboard shots, layers, local nodes). 'copy' and 'wordmark' are placed by hand below.
  const UI = new Map();
  { let i = 0; for (const c of cues) if (c.kind === 'blip' && c.id !== 'copy' && c.id !== 'wordmark') UI.set(ms(c.t), LYD[i++ % 4]); }
  // rank numerals 5 -> 2 climb the motif, rank 1 = D5 (the maj7: bright, still a question)
  const RANK = { 5: 72, 4: 75, 3: 69, 2: 70, 1: 74 };

  // ---------------------------------------------------------------- explicit melodic statements (notes[])
  const notes = [];
  const motif = (voice, t0, mid, { scale = 1, vel = 0.85, gate = 0.92, oct = 0, only } = {}) =>
    mid.forEach((n, i) => { if (only && !only.includes(i)) return; notes.push({ voice, at: t0 + CELL[i] * scale * STEP, note: n + 12 * oct, dur: LEN[i] * scale * STEP * gate, vel: i === 0 ? vel : vel * 0.85 }); });
  // cold open: the minor motif solo and dry at 0.00, then its first two notes again (the question repeats)
  motif('lead', 0, MIN, { vel: 0.9 });
  motif('lead', BAR, MIN, { vel: 0.8, only: [0, 1] });
  // the reach: augmented lydian statement that STARTS in the cold open on the send tick (C natural over Ebm = the
  // lydian arriving early), Eb5 on "Your agent." (3.41 s), the leap onto A natural ON the lock (4.09 s), Bb4 after it
  [[2.386, 72, 0.9], [3.409, 75, 0.9], [4.091, 69, 1], [4.432, 70, 0.85]].forEach(([at, note, vel], i) =>
    notes.push({ voice: 'lead', at: at < 2.4 ? 2 * BAR - 4 * STEP : at, note, dur: i === 3 ? 6 * STEP : 10 * STEP, vel }));
  // rebuild (bars 16-17): the motif full, then its retrograde under the riser
  motif('lead', 16 * BAR, LYD, { vel: 0.8 });
  [[0, 70], [4, 69], [6, 75], [10, 72]].forEach(([c, n]) => notes.push({ voice: 'lead', at: 17 * BAR + c * STEP, note: n, dur: 3.5 * STEP, vel: 0.7 }));
  // peak bar 18: canon, the lead and its octave double half a bar apart
  motif('lead', 18 * BAR, LYD, { vel: 0.95 });
  motif('lead8', 18 * BAR + 8 * STEP, LYD, { vel: 0.8, oct: 1, only: [0, 1, 2] });
  // peak bar 19: the motif re-voiced for the surprise chord (Cbmaj7: Eb5 Bb4) then F/Eb (A4 C5 F5), in octaves
  for (const [v, o, g] of [['lead', 0, 0.95], ['lead8', 12, 0.75]])
    [[0, 75, 6], [6, 70, 4], [8, 69, 2], [10, 72, 2], [12, 77, 3]].forEach(([c, n, l]) => notes.push({ voice: v, at: 19 * BAR + c * STEP, note: n + o, dur: l * STEP * 0.92, vel: g }));
  // sonic logo on the end card: C5 (final) Eb5 (tail swings) A4 (wordmark) Bb4 (tagline 1) -> Eb5 on 28.30 s, ringing
  const L0 = 20 * BAR;
  [[0, 72, 2], [2, 75, 2], [4, 69, 4], [8, 70, 4]].forEach(([c, n, l]) => notes.push({ voice: 'lead', at: L0 + c * STEP, note: n, dur: l * STEP * 0.95, vel: 0.95 }));
  notes.push({ voice: 'lead', at: L0 + 12 * STEP, note: 75, dur: 1.65, vel: 1 });
  notes.push({ voice: 'lead8', at: L0 + 12 * STEP, note: 87, dur: 1.5, vel: 0.55 });
  // final chord Eb6/9#11, spread: Eb2 Bb2 G3 C4 F4 A4 (a MIDI array, rings 2.7 s)
  const FINAL = [39, 46, 55, 60, 65, 69];

  return {
    bpm: config.bpm, meter: config.meter, stepsPerBar: 16,
    key: 'Eb', mode: 'lydian', seed: 1766,
    swing: { hat: 0.53, ghost: 0.53, ride: 0.52, default: 0.5 },
    humanize: { hat: { ms: 3, vel: 0.12 }, ghost: { ms: 4, vel: 0.15 }, default: { ms: 0, vel: 0 } },

    voices: {
      // drums: a written two-step break, tuned (kick f1 near Eb1)
      kick: { inst: 'kick', f0: 165, f1: 40, pitchTau: 0.028, decay: 0.2, click: 0.4, gain: 0.72, harmonics: -8 },
      snare: { inst: 'snare', body: 205, drop: 0.25, wires: 2600, decay: 0.085, mix: 0.62, gain: 0.5, send: 0.14 },
      ghost: { inst: 'rim', f1: 620, f2: 2300, decay: 0.014, gain: 0.16, pan: -0.25 },
      hat: { inst: 'hat', mode: 'metal', tone: 8800, gain: 0.2, pan: 0.22, choke: 'hh' },
      ohat: { inst: 'hat', mode: 'metal', open: true, decay: 0.07, tone: 8000, gain: 0.13, pan: 0.28, choke: 'hh' },
      ride: { inst: 'ride', decay: 0.9, ping: 0.6, gain: 0.1, pan: -0.3, minEnergy: 4 },
      // low end: a pure sub that follows the kick + a reese with harmonics so phones play the line
      sub: { inst: 'sub', cut: 190, octave: 1, gain: 0.42, gate: 1 },
      reese: { inst: 'reese', detune: 13, cut: 680, res: 0.22, octave: 1, gain: 0.3, harmonics: -7, send: 0.04 },
      // harmony: a spread pad in 200 Hz-2 kHz, glass-FM arpeggio, a soft pluck (the "clips" layer)
      pad: { inst: 'pad', cut: 1500, attack: 0.25, release: 0.7, detune: 8, chorus: 0.45, lfo: 0.18, gain: 0.2, send: 0.4, voicing: 'close', center: 63, size: 4 },
      arp: { inst: 'fm', ratio: 2.32, index: 1.1, idecay: 0.12, decay: 0.28, dur: 0.18, gain: 0.13, send: 0.3, dsend: 0.22, octave: 5, pan: 0.3 },
      pluck: { inst: 'pluck', decay: 0.13, index: 1.25, gain: 0.17, send: 0.25, octave: 4, pan: -0.3 },
      // the hook: FM glass (carrier 1 : modulator 2.32, the glass panel's 2nd mode), its octave double in the peak
      lead: { inst: 'fm', ratio: 2.32, index: 1.5, idecay: 0.22, decay: 0.9, attack: 0.002, release: 0.12, gain: 0.34, send: 0.32, dsend: 0.18 },
      lead8: { inst: 'fm', ratio: 2.32, index: 1.1, idecay: 0.18, decay: 0.7, attack: 0.002, release: 0.1, gain: 0.22, send: 0.4, dsend: 0.25, pan: 0.25 },
      // UI material: the phone's glass panel tapped by a fingertip, pitched to the motif / chord
      glass: { inst: 'modal', shape: 'plate', aspect: SCREEN_ASPECT, strike: [0.31, 0.37], decay: OBJECT_MATERIALS.glass.tau * 1.2, hard: 0.45, tilt: 0.6, gain: 0.3, send: 0.28, octave: 5 },
      // impact low end: an 808 drop with harmonics (boom, lock, the wall, rank 1, final)
      drop: { inst: 'e808', decay: 0.9, drive: 1.3, glide: 0.12, gain: 0.5, harmonics: -6 },
    },

    progressionMode: 'section', chordBars: 1,
    progression: ['Ebmaj9', 'F/Eb', 'Gm7/Eb', 'Ebmaj7#11'],

    grids: {
      // cold open bar 1: the pad breathes in under the typing, no drums (the keycaps are the hats)
      air: { pad: { hold: true, gain: 0.55 } },
      // the drop (energy 3): two-step break, sub on the kick, reese answering it with a glide-feel approach note
      drop: {
        pad: 'hold',
        kick: 'X.........x.....' + 'X.x.......x..x..',
        snare: '....X..o....X...' + '.o..X.......X.oo',
        ghost: '..o....o.o...o..' + '..o..o...o...o..',
        hat: '..x.o.x.o.x.oox.' + 'o.x.oox.o.x.o.xx',
        ohat: '..............x.' + '......x.........',
        sub: 'R_________R_____' + 'R_R_______R__R__',
        reese: '..R___.R___.R_A_' + '..R_____.R__R_A_',
      },
      // the app (energy 2): lighter break, reese enters properly, the UI carries the melody
      app: {
        pad: { hold: true, gain: 0.8 },
        kick: { grid: 'X.........x.....' + 'X.........x..x..', gain: 0.8 },
        snare: { grid: '....x.......x...' + '....x.......x..o', gain: 0.85 },
        hat: { grid: '..x...x...x...x.' + 'o.x...x.o.x...xo', gain: 0.8 },
        sub: { grid: 'R_________R_____', gain: 0.75 },
        reese: { grid: 'R_____.R__.R_A__' + 'R_____.R___.R_A_', gain: 0.8 },
      },
      // the layer stack (bars 8-9, one 32-cell phrase): each layer that lands brings its instrument in (assembly):
      // beat 1 pictures -> glass arp · beat 2 clips -> pluck · beat 3 voice -> reese + sub · bar 9 captions -> hats,
      // bar 9 beat 2 music -> the full kit
      stack: {
        pad: 'hold',
        arp: { grid: '....x.x.x.x.x.x.' + 'x.x.x.x.x.x.x.x.', notes: 'up', arpOctaves: 2 },
        pluck: '........x..x.x..' + 'x..x..x.x..x..x.',
        reese: '............R___' + '..R___.R___.R_A_',
        sub: '............R___' + '....R_____R_____',
        hat: '................' + 'o.x.o.x.o.x.ooxx',
        kick: '................' + '....X.....x.....',
        snare: '................' + '........X...X.XX',
      },
      // ranking (energy 3): the bass plays the motif as an ostinato (section motif below), break gets busier
      rank: {
        pad: { hold: true, gain: 0.7 },
        kick: 'X.........x.....' + 'X.....x...x..x..',
        snare: '....X.......X...' + '....X..o....X.o.',
        ghost: '.o....o..o....o.' + '.o..o.....o..o..',
        hat: 'o.x.oox.o.x.o.xx' + 'o.x.o.x.oox.o.xo',
        ohat: '......x.........' + '..............x.',
        arp: { grid: 'x..x..x.', notes: 'up', gain: 0.6 },
      },
      // breakdown (energy 1): kick + snare only, half-time, a 3-cell glass arp drifting against the 16 (polymeter,
      // mirrored by the counters ticking in threes), the bass held
      brk: {
        pad: 'hold',
        kick: 'X...............' + '..........X.....',
        snare: '........X.......',
        arp: { grid: 'x..', phase: 'global', notes: 'updown', arpOctaves: 2, gain: 1.15 },
        sub: { grid: 'R_______________', gain: 0.7 },
      },
      // rebuild (energy 3)
      rebuild: {
        pad: 'hold',
        kick: 'X.........x.....' + 'X.x.......x.....',
        snare: '....X..o....X...' + '....X.......X.oX',
        ghost: '..o....o.o...o..',
        hat: { grid: 'o.x.o.x.o.x.oox.' + 'oxx.o.x.oox.oxxx', gain: 0.85 },
        sub: { grid: 'R_________R_____', gain: 0.8 },
        reese: { grid: '..R___.R___.R_A_', gain: 0.85 },
        arp: { grid: 'x.x.x.x.x.x.x.x.', notes: 'up', gain: 0.6 },
      },
      // peak (energy 4): busiest break, ride, the reese per half-bar chord; cell 31 rests for the gap before the final
      peak: {
        pad: { hold: true, gain: 1.2 },
        kick: 'X.........x..x..' + 'X.x.......x.....',
        snare: { grid: '....X..o....X...' + '....X..o....Xo..', gain: 1.15 },
        ghost: '..o....o.o...o..' + '..o..o...o...o..',
        hat: 'o.x.oox.oox.o.xx' + 'o.x.oox.o.x.ox..',
        ohat: '......x.......x.' + '......x.........',
        ride: 'x.x.x.x.x.x.x.x.' + 'x.x.x.x.x.x.x...',
        sub: { grid: 'R_________R_____' + 'R_________R___..', gain: 1.1 },
        reese: { grid: '..R___.R..R_A_..' + '..R___.R..R_A_..', gain: 1.2 },
        arp: { grid: 'x.x.x.x.x.x.x.x.' + 'x.x.x.x.x.x.x...', notes: 'updown', arpOctaves: 2 },
      },
      // end card: the chord rings, the sub holds the root
      ring: { pad: { hold: true, gain: 1.1 }, sub: { grid: 'R_______________' + '________________', gain: 0.8 } },
    },

    motif: { degrees: [5, 7, 3, 4], rhythm: 'X_____x___x_x___', voice: 'reese', legato: true, gate: 0.95 },

    sections: [
      { name: 'hook', bars: 1, energy: 0, mode: 'aeolian', prog: ['Ebm9'], grid: {} },
      { name: 'typing', bars: 1, energy: 1, mode: 'aeolian', prog: ['Ebm9'], grid: 'air',
        fx: [{ kind: 'filter', type: 'lp', bar: 0, bars: 1, f0: 500, f1: 2600, bus: 'music' }] },
      { name: 'drop', bars: 2, energy: 3, grid: 'drop', prog: ['Ebmaj9', 'F/Eb'] },
      { name: 'app', bars: 4, energy: 2, grid: 'app' },
      { name: 'stack', bars: 2, energy: 3, grid: 'stack', prog: ['Ebmaj9', 'F/Eb'] },
      { name: 'rank', bars: 4, energy: 3, grid: 'rank', motif: { voice: 'reese', every: 1, octave: 1, vel: 0.95 } },
      { name: 'breakdown', bars: 2, energy: 1, grid: 'brk', prog: ['Cm9', 'Bbsus4'],
        fx: [{ kind: 'filter', type: 'lp', bar: 0, bars: 2, f0: 2200, f1: 700, bus: 'music' }] },
      { name: 'rebuild', bars: 2, energy: 3, grid: 'rebuild', prog: ['Ebmaj9', 'F/Eb'], fx: ['riser'] },
      { name: 'peak', bars: 2, energy: 4, grid: 'peak', prog: ['Gm7/Eb', 'Ebmaj7#11', 'Cbmaj7', 'F/Eb'], chordBars: 0.5 },
      { name: 'ring', bars: 2, energy: 1, grid: 'ring', prog: [FINAL], chordBars: 2 },
    ],

    notes,

    fx: [
      // zoom into the numeral 1: the groove powers down over the last beat and the breakdown starts clean
      { kind: 'tapestop', at: 14 * BAR - BEAT, dur: BEAT, resume: 14 * BAR, bus: 'band' },
      // box unfolds: things gather inward, a reversed swell that stops one 16th before the wall lands
      { kind: 'reverse', at: 16 * BAR - STEP, dur: 2 * BEAT, gain: 0.8 },
      // rest as accent: one 16th of air before rank 1 is revealed (the roll stops short of it)
      { kind: 'gap', at: 13 * BAR - STEP, dur: STEP, bus: 'all' },
      // the gap before the final hit (the drop's gap is a cue on the sheet)
      { kind: 'gap', at: 20 * BAR - STEP, dur: STEP, bus: 'all' },
    ],

    cues: {
      // typing as drums: each key = an 18 mm ABS keycap plate struck by a fingernail + a small switch thock
      key: (c, api) => {
        api.inst('modal', { shape: 'plate', aspect: 1, strike: [0.42, 0.47], f: KEYCAP_HZ, decay: OBJECT_MATERIALS.abs.tau * 1.5, hard: 0.85, gain: 0.55 * (c.g ?? 1), pan: -0.15 + 0.3 * api.rand() });
        api.inst('key', { f: 2400, thock: 0.22, decay: 0.006, gain: 0.35 * (c.g ?? 1) });
      },
      // user clicks ask (keycap), the agent's elements answer (glass)
      tick: (c, api) => {
        if (/^click|^send/.test(c.id ?? '')) {
          api.inst('modal', { shape: 'plate', aspect: 1, strike: [0.45, 0.5], f: KEYCAP_HZ * 0.82, decay: 0.05, hard: 0.9, gain: 0.5 * (c.g ?? 1) });
          api.inst('key', { f: 2000, thock: 0.3, gain: 0.4 * (c.g ?? 1) });
        } else if (c.id === 'odometer-roll') {
          const k = ms(c.t);
          if (TICKED.has(k)) return; TICKED.add(k);
          api.play('glass', { note: 96 + (TICKED.size % 3) * 2, vel: 0.18, dur: 0.05, gain: 0.5 });
        } else api.play('glass', { note: 91, vel: 0.35 * (c.g ?? 1), dur: 0.08 });
      },
      blip: (c, api) => {
        let n = UI.get(ms(c.t));
        if (c.id === 'copy') n = c.t < 4 ? 75 : 81;            // Eb5 on "Your agent.", A5 shimmer on the lock
        if (c.id === 'wordmark') n = 69;                        // logo note 3 (A4)
        if (n == null) n = api.cueNote(c.note ?? 0);
        const vel = (c.id === 'answer-check' ? 0.55 : c.id === 'card-option' ? 0.5 : 0.75) * (c.g ?? 1);
        api.play('glass', { note: n, vel, dur: 0.5 });
        if (/^layer|storyboard/.test(c.id ?? '')) api.play('glass', { note: n + 12, vel: vel * 0.35, dur: 0.3, t: c.t + STEP / 2 });
      },
      bell: false,
      // impact stack: gap (sheet) -> 808 drop + glass chord strike + transient, chord from the music at that moment
      boom: (c, api) => {
        api.play('drop', { note: 27, dur: 0.9, vel: 0.95, from: 39 });   // the grid's kick lands on the same cell
        api.play('glass', { notes: [63, 70, 74, 77, 82], vel: 0.9, dur: 1.2 });
        api.inst('shatter', { n: 24, spread: 0.18, lo: 2500, hi: 8000, gain: 0.35 });
      },
      lock: (c, api) => {
        if (c.id === 'odometer-land') { const n = { 20114: 82, 20455: 84, 20795: 87 }[ms(c.t)] ?? 84; api.play('glass', { notes: [n, n + 7], vel: 0.45, dur: 0.6 }); return; }
        api.play('drop', { note: 29, dur: 0.5, vel: 0.7, from: 36 });
        api.play('glass', { notes: [65, 69, 72, 77], vel: 0.85, dur: 1.0 });   // F/Eb's upper triad, A natural on top
      },
      burst: (c, api) => {
        if (c.id === 'explode') { api.inst('shatter', { n: 40, spread: 0.3, lo: 2200, hi: 7500, gain: 0.5 }); api.play('glass', { notes: [63, 70, 74], vel: 0.6, dur: 0.8 }); return; }
        // the wall lands (hero): 808 + glass chord + kick
        api.play('drop', { note: 27, dur: 0.7, vel: 0.9, from: 34 });
        api.play('glass', { notes: [63, 67, 70, 74, 79], vel: 0.9, dur: 1.1 });
      },
      cut: (c, api) => {
        if (c.rank) {
          const n = RANK[c.rank];
          api.play('glass', { notes: [n, n + 12], vel: c.rank === 1 ? 1 : 0.75, dur: 0.6 });
          if (c.rank === 1) { api.play('drop', { note: 27, dur: 0.6, vel: 0.85, from: 39 }); api.inst('shatter', { n: 18, spread: 0.12, lo: 3000, hi: 8000, gain: 0.25 }); }
          return;
        }
        // title slam and the feed lines: a glass chord stab from the current chord
        api.play('glass', { chord: true, vel: 0.7, dur: 0.7 });
        if (/^feed-line/.test(c.id ?? '')) api.play('glass', { note: { 'feed-line-0': 79, 'feed-line-1': 82, 'feed-line-2': 87 }[c.id] ?? 82, vel: 0.6, dur: 0.6 });
      },
      pop: (c, api) => {
        if (c.id === 'tagline-0') { api.play('glass', { note: 70, vel: 0.6, dur: 0.5 }); return; }   // logo note 4 (Bb4)
        if (c.id === 'tagline-1') { api.play('glass', { note: 94, vel: 0.25, dur: 0.6 }); return; }  // a sparkle on the ring
        if (c.id === 'wave') { [0, 1, 2, 3].forEach(k => api.play('glass', { note: [79, 82, 86, 89][k], vel: 0.35 + 0.1 * k, dur: 0.3, t: c.t + k * STEP / 2 })); return; }
        const top = api.chordAt(c.t); api.play('glass', { note: top[top.length - 1] + 12, vel: 0.4 + (c.s ?? 0.2), dur: 0.35 });
      },
      snap: (c, api) => {
        if (c.id === 'snare-roll') { (c.t > 17.5 ? [0, 1] : [0, 1, 2, 3]).forEach(k => api.play('snare', { t: c.t + k * STEP / 2, vel: 0.22 + 0.13 * k })); return; }
        if (c.id === 'tail-swing') { api.play('glass', { note: 75, vel: 0.6, dur: 0.5 }); return; }    // logo note 2 (Eb5)
        api.play('glass', { notes: [70, 77], vel: 0.6, dur: 0.4 });                                    // layers close
      },
      final: (c, api) => {
        api.play('drop', { note: 27, dur: 2.6, vel: 0.9, from: 34 });
        api.play('kick', { vel: 1 });
        api.play('glass', { notes: [63, 72, 77, 81], vel: 0.85, dur: 2.4 });
      },
      // transitions: the outgoing scene owns the sound; glass and air, no stock whoosh per cut
      sweep: (c, api) => api.inst('sweep', { dur: c.d, f0: c.f0 ?? 300, f1: c.f1 ?? 2400, gain: 0.22 }),
      whoosh: (c, api) => {
        const id = c.id ?? (c.t < 6 ? 'dive' : c.t < 11 ? 'lift' : '');
        if (id === 'dive') api.inst('whoosh', { dur: c.d, dir: -1, lo: 450, hi: 2800, gain: 0.4 });
        else if (id === 'lift') api.inst('sweep', { dur: c.d, f0: 420, f1: 1700, gain: 0.18 });
        else if (id === 'phone-flip') api.inst('doppler', { dur: 0.34, f: 1700, shift: 0.3, dir: -1, gain: 0.45 });
        else if (id === 'zoom-into-1') api.inst('sweep', { dur: c.d, f0: 2600, f1: 260, gain: 0.22 });
        else if (id === 'merge') api.inst('whoosh', { dur: c.d - STEP, dir: 1, lo: 280, hi: 1900, gain: 0.32 });
      },
      reverse: false,     // the sheet's swell would end at 21.14 s; the fx above ends it at the wall instead
      flash: false, transition: false,
    },

    mix: {
      duck: { by: ['kick', 'boom', 'final'], depth: 0.4, beats: 0.5, targets: ['music'] },
      reverb: { size: 0.72, damp: 0.42, wet: 0.7 },
      reverbBus: { beat: 0.5, music: 1, sfx: 0.9 },
      delay: { beats: 0.75, fb: 0.28, lp: 3800, wet: 0.7, spread: 1 },
      hp: 28, monoBelow: 140, width: 1.05,
    },
  };
};

