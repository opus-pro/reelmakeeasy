// Rhythm tools: meters, grid strings, Euclidean patterns, Linn swing, seeded humanize.
//
// GRID STRINGS (one character per step; '|' and spaces are ignored and only help reading):
//   X accent (1.0)   x normal (0.75)   o ghost (0.35)   . or - rest   _ tie (extends the previous hit by one step)
//   Pitched voices may also use chord tokens: R root · 3 third · 5 fifth · 7 seventh · 9 ninth · O octave
//   · A approach (a semitone below the next chord's bass) · C the whole chord (stab).
//   A grid's length is its own cycle: length = steps per bar -> a 1-bar loop, 2x -> a 2-bar phrase,
//   anything else (3, 5, 7, 10 ...) -> polymeter that drifts across the bar line and realigns later.
//   Macros: E(k,n) or E(k,n,rot) expands to a Euclidean pattern of k hits in n steps (Toussaint).
//           Concatenate with '+':  'E(3,8)+E(5,8)'.  Repeat with '*':  'x...*3' (= 'x...x...x...').
// METERS: '4/4' '3/4' '6/8' '12/8' '5/4' '7/8' '9/8' '2/4' ... BPM always counts QUARTER notes (the picture's
//   T.beat). beatsPerBar = num*4/den (7/8 -> 3.5), stepsPerBar = num*16/den 16ths (7/8 -> 14).
//   Override with { beatsPerBar, stepsPerBar } or meter: '7/8', stepsPerBar: 7 (8ths).

export const VEL = { X: 1, x: 0.75, o: 0.35 };
export const RESTS = new Set(['.', '-']);
export const PITCH_TOKENS = new Set(['R', '3', '5', '7', '9', 'O', 'A', 'C']);

/** Euclidean rhythm E(k, n) rotated by rot: k onsets spread as evenly as possible over n steps */
export const euclid = (k, n, rot = 0, ch = 'x') => Array.from({ length: n }, (_, i) => ((((i + rot) * k) % n + n) % n < k ? ch : '.')).join('');

/** Expand macros and strip separators. Returns a string of single-character cells. */
export function expandGrid(src) {
  if (typeof src !== 'string') throw new Error(`grid must be a string, got ${JSON.stringify(src)}`);
  const parts = src.split('+').map(p => p.trim()).filter(Boolean);
  let out = '';
  for (let p of parts) {
    let rep = 1; const mr = /\*(\d+)\s*$/.exec(p); if (mr) { rep = +mr[1]; p = p.slice(0, mr.index); }
    p = p.replace(/E\((\d+),\s*(\d+)(?:,\s*(-?\d+))?(?:,\s*([Xxo]))?\)/g, (_, k, n, r, c) => euclid(+k, +n, +(r || 0), c || 'x'));
    p = p.replace(/[|\s]/g, '');
    out += p.repeat(rep);
  }
  if (!out.length) throw new Error(`empty grid "${src}"`);
  if (/^\s*hold\s*$/i.test(src)) throw new Error(`grid "${src}": a held note is not a grid string. Write the pattern as 'hold', or as an object { hold: true, gain, ... } / { grid: 'hold', gain, ... }`);
  const bad = [...out].filter(c => !(c in VEL) && !RESTS.has(c) && c !== '_' && !PITCH_TOKENS.has(c));
  if (bad.length) throw new Error(`grid "${src}" has unknown characters: ${[...new Set(bad)].join(' ')} (allowed: X x o . - _ R 3 5 7 9 O A C | and E(k,n))${/[a-z]{3,}/i.test(src) && !/E\(/.test(src) ? `. Words are not grids; a held note is 'hold' or { hold: true, ... }` : ''}`);
  return out;
}

/** Parse a meter. Returns { num, den, beatsPerBar (quarter notes), stepsPerBar, label } */
export function meterInfo(meter = '4/4', stepsOverride) {
  let num, den, bpb, spb;
  if (meter == null) meter = '4/4';
  if (typeof meter === 'string' && /^\s*(free|rubato)\s*$/i.test(meter)) meter = '4/4';    // engine parseMeter: free = a 4/4 grid
  if (typeof meter === 'number') { bpb = meter; spb = Math.round(meter * 4); num = meter; den = 4; }  // 03 §4.1 form: meter 3.5 = 7/8
  else if (typeof meter === 'object' && meter) { bpb = meter.beatsPerBar; spb = meter.stepsPerBar ?? Math.round(bpb * 4); num = meter.num ?? bpb; den = meter.den ?? 4; }
  else {
    const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(String(meter));
    if (!m) throw new Error(`meter "${meter}" not understood (use '4/4', '7/8', '5/4', '6/8', '12/8' ... or {beatsPerBar, stepsPerBar})`);
    num = +m[1]; den = +m[2];
    if (![1, 2, 4, 8, 16].includes(den)) throw new Error(`meter denominator must be 1, 2, 4, 8 or 16 (got ${den})`);
    bpb = num * 4 / den; spb = num * 16 / den;
  }
  if (stepsOverride) spb = stepsOverride;
  if (!(bpb > 0) || !(spb > 0) || spb !== Math.round(spb)) throw new Error(`meter gives beatsPerBar=${bpb}, stepsPerBar=${spb}: both must be positive, steps an integer`);
  const label = typeof meter === 'string' ? meter.trim() : (Number.isInteger(bpb * 2) && !Number.isInteger(bpb) ? `${bpb * 2}/8` : `${bpb}/4`);
  return { num, den, beatsPerBar: bpb, stepsPerBar: spb, label };
}

/**
 * Linn swing: within each pair of steps, the second one is delayed by (2s - 1) * stepSec.
 * s = 0.5 straight, 0.54 loosens, ~0.58 a light swing, 0.66 ~ triplet feel, 0.75 dotted.
 * Only meaningful when a beat holds an even number of steps; otherwise returns 0.
 */
export function swingOffset(k, swing, stepSec, stepsPerBeat) {
  if (!swing || swing === 0.5) return 0;
  if (Math.abs(stepsPerBeat - Math.round(stepsPerBeat)) > 1e-6 || Math.round(stepsPerBeat) % 2) return 0;
  return k % 2 === 1 ? (2 * swing - 1) * stepSec : 0;
}

/** cells -> list of {i (cell index), ch, len (cells incl. ties)} */
export function hitsOf(cells) {
  const out = [];
  for (let i = 0; i < cells.length; i++) {
    const ch = cells[i];
    if (RESTS.has(ch) || ch === '_') continue;
    let len = 1; while (cells[(i + len) % cells.length] === '_' && len < cells.length) len++;
    out.push({ i, ch, len });
  }
  return out;
}
