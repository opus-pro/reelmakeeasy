// Cue sound design: what each cue kind in build/cues.json sounds like. Scenes emit cues from their pure
// cues(o, at, dur, config, T); the same list drives shake/flash in the picture, so sound and picture share
// one timeline. Every kind can be re-voiced per reel in music.mjs:
//   cues: { <kind>: '<voice>'                        // play a music.mjs voice (pitched by c.note degree, else the chord root)
//           <kind>: { type: '<instrument>', ...params }   // an instrument with parameters (inst: works too)
//           <kind>: { voice: '<voice>', deg, dur, ... }
//           <kind>: false                             // silence this kind
//           <kind>: (c, api) => { api.play(...); api.inst(...); } }   // anything
// Defaults below are the legacy palette (sub boom, chord stabs, FM bells). They are pitched from THIS reel's
// key/scale/progression, but they are still a house sound: re-voice the kinds your reel uses (03 §4.10:
// one material family per reel).
//
// Time alignment: c.t is the START of the sound, except doppler (c.t = the pass-by centre) and
// reverse (c.t = the hit the swell rushes into; it ends exactly there).

export const CUE_DOC = {
  // legacy kinds (scenes in library/legacy-scenes emit these)
  key: 'typing key click', tick: 'counter tick (f Hz)', blip: 'pitched UI blip (note = scale degree)', bell: 'FM bell (note = degree)',
  stab: 'chord stab', whoosh: 'panned noise whoosh (d, dir)', riser: 'noise riser (d)', sweep: 'sine sweep (d, f0, f1)', snip: 'scissor snip',
  shutter: 'camera shutter', boom: 'sub drop + noise burst (s = size)', cut: 'stab (+ small boom if s >= .45)', burst: 'stab', lock: 'boom + chord bells',
  pop: 'light clap', snap: 'full clap', soft: 'long soft stab', final: 'boom + chord + bell run + held sub (the resolve)',
  // transition sounds (02 Part 6)
  doppler: 'pass-by whoosh centred on t (d, dir, f)', shepard: 'endless rise/fall (d, dir, rate)', aperture: 'iris: micro-ticks + 3 kHz ring',
  crackle: 'paper-tear crackle (d, rate)', bloop: 'ink drop + bubbles', downlifter: 'falling filtered noise (d)',
  // bus effects: process what is already playing (bus: 'band' = music+beat (default), 'all', or a bus name)
  gap: 'silence [t, t+d) on every bus (keep: [bus] to leave one in)', tapestop: 'tape stop over d (curve, resume s)',
  bitcrush: 'sample-and-hold crush over d (bits, hold)', reverse: "mode 'swell' (default: reversed tail ending at t) | 'rewind' (replace [t,t+d) with the past played backwards, speed)",
  granular: 'granular freeze over d (src s, grain, density, scatter, jitter)', filter: "bus sweep over d (type lp|hp|bp, f0, f1, q, hold)",
  stutter: 'repeat a slice (len s) across d',
  // musical
  note: 'play a music.mjs voice: {voice, note|deg|tone|chord, vel, dur}', motif: 'state the music.mjs motif at t (transform, voice, octave)',
  sfx: 'any instrument directly: {inst, ...params}',
};
export const BUS_KINDS = new Set(['gap', 'tapestop', 'bitcrush', 'reverse', 'granular', 'filter', 'stutter']);

/**
 * Default voicing for legacy + transition kinds. api: { inst(name, params), chordAt(t), cueNote(deg), duration, rand }
 * A cue's g scales every sound its kind makes (boom: s x g), so one hit can sit lower without re-voicing the kind
 * (iteration 3: halving gains elsewhere moved a limiter WARN by 0.1 dB because the hit's own level had no knob).
 * Returns true if the kind was handled.
 */
export function defaultCue(c, api) {
  const t = c.t, g = c.g ?? 1, ch = () => api.chordAt(t), up = (k = 12) => ch().map(m => m + k);
  const I = (name, p) => api.inst(name, { t, ...p });
  switch (c.kind) {
    case 'key': I('key', { gain: 0.9 * g }); return true;
    case 'tick': I('tick', { gain: g, f: c.f ?? 4200 }); return true;
    case 'blip': I('blip', { note: api.cueNote(c.note ?? 0), gain: g, pan: (((c.note ?? 0) % 3) - 1) * 0.4 }); return true;
    case 'bell': I('bell', { note: api.cueNote((c.note ?? 0) + 5), gain: 0.5 * g, pan: (((c.note ?? 0) % 4) - 1.5) * 0.4 }); return true;
    case 'stab': I('stab', { notes: up(), gain: 0.8 * g, dur: 0.6, bright: 2400 }); return true;
    case 'whoosh': I('whoosh', { dur: c.d ?? 0.5, gain: 0.9 * g, dir: c.dir ?? (Math.round(t * 2) % 2 ? -1 : 1) }); return true;
    case 'riser': I('riser', { dur: c.d ?? 0.6, gain: 0.75 * g }); return true;
    case 'sweep': I('sweep', { dur: c.d ?? 1, f0: c.f0 ?? 200, f1: c.f1 ?? 1200, gain: g }); return true;
    case 'snip': I('snip', { gain: 1.2 * g }); return true;
    case 'shutter': I('shutter', { gain: g }); return true;
    case 'boom': I('boom', { gain: (c.s ?? 1) * g }); return true;
    case 'cut': I('stab', { notes: up(), gain: 1.0 * g, dur: 0.4, bright: 4000 }); if ((c.s ?? 0) >= 0.45) I('boom', { gain: 0.35 * g }); return true;
    case 'burst': I('stab', { notes: up(), gain: 0.8 * g, dur: 0.5, bright: 3000 }); return true;
    case 'lock': I('boom', { gain: 0.45 * g }); ch().forEach((m, i) => api.inst('bell', { t: t + i * 0.03, note: m + 24, gain: 0.5 * g, pan: i / 3 - 0.6 })); return true;
    case 'pop': I('clap', { gain: 0.25 * g }); return true;
    case 'snap': I('clap', { gain: 0.9 * g }); return true;
    case 'soft': I('stab', { notes: up(), gain: 0.6 * g, dur: 1.1, bright: 1700 }); return true;
    case 'final': {
      const c0 = ch(), root = c0.length ? c0[0] : 60;
      I('boom', { gain: 0.75 * g }); I('stab', { notes: [root, root + 7, ...c0.map(m => m + 12)], gain: 1.2 * g, dur: 1.9, bright: 5000 });
      [0, 2, 4, 5, 7].forEach((n, i) => api.inst('bell', { t: t + i * 0.05, note: api.cueNote(n + 5), gain: 0.8 * g, pan: i / 2 - 1 }));
      I('sub', { note: root - 24 + (root - 24 < 28 ? 12 : 0), dur: Math.max(0.5, api.duration - t), gain: 0.5 * g });
      return true;
    }
    case 'doppler': { const d = c.d ?? 0.6; api.inst('doppler', { t: t - d / 2, dur: d, dir: c.dir ?? 1, f: c.f ?? 1400, gain: g }); return true; }
    case 'shepard': I('shepard', { dur: c.d ?? 2, dir: c.dir ?? 1, rate: c.rate ?? 0.5, gain: g }); return true;
    case 'aperture': I('aperture', { gain: g }); return true;
    case 'crackle': I('crackle', { dur: c.d ?? 0.5, rate: c.rate ?? 500, gain: g }); return true;
    case 'bloop': I('bloop', { gain: g }); return true;
    case 'downlifter': I('downlifter', { dur: c.d ?? 1, gain: g }); return true;
    default: return false;
  }
}
