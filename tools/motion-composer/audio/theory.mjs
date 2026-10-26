// Pitch, scales, chords and voicing. Pure functions, no state.
//
// Conventions (also documented in score.mjs --help):
//  - MIDI numbers: C4 = 60. Note names: 'C4', 'Eb3', 'F#5'. A name without octave is a pitch class.
//  - Scale DEGREES are 0-based offsets from the tonic (0 = tonic, 7 in a 7-note scale = tonic an octave up,
//    -1 = the note below the tonic). Used by motifs, `notes:` cycles, `deg:` in cues and play().
//  - PROGRESSIONS use Roman numerals relative to the CURRENT SCALE (mode-relative): in A aeolian VI = F.
//    Case sets quality (upper = major, lower = minor); suffixes add extensions ('maj7', '7', 'm9', 'sus4', ...).
//    'bVI', '#IV' alter the root. 'V/IV' = secondary (V of IV, built on IV's major scale).
//    'II>I' = II chord over the I bass (pedal / slash bass). Numbers (or '1^7') = diatonic chords stacked in thirds
//    from the scale, 1-based like Roman numerals. Absolute names work too: 'Ebmaj7', 'C#m9', 'D/C'.
//    Raw arrays [50, 54, 57] or ['D3', 'F#3', 'A3'] are taken literally. '-' or 'N.C.' = no chord.

export const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const SCALES = {
  ionian: [0, 2, 4, 5, 7, 9, 11], major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10], minor: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10], harmonicMinor: [0, 2, 3, 5, 7, 8, 11], melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10], lydianDominant: [0, 2, 4, 6, 7, 9, 10], dorianSharp4: [0, 2, 3, 6, 7, 9, 10],
  majorPentatonic: [0, 2, 4, 7, 9], minorPentatonic: [0, 3, 5, 7, 10], blues: [0, 3, 5, 6, 7, 10],
  wholeTone: [0, 2, 4, 6, 8, 10], diminished: [0, 2, 3, 5, 6, 8, 9, 11], chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

/** 'Eb4' -> 63, 'F#' -> pitch class 6 (when allowPc), 61 -> 61 */
export function parseNote(n, { allowPc = false } = {}) {
  if (typeof n === 'number') return n;
  const m = /^\s*([A-Ga-g])([#b]*)(-?\d+)?\s*$/.exec(String(n));
  if (!m) throw new Error(`Bad note name "${n}" (use e.g. 'C4', 'Eb3', 'F#5' or a MIDI number)`);
  let pc = NOTE_PC[m[1].toUpperCase()];
  for (const a of m[2]) pc += a === '#' ? 1 : -1;
  if (m[3] === undefined) { if (allowPc) return ((pc % 12) + 12) % 12; throw new Error(`Note "${n}" needs an octave here (e.g. ${n}4)`); }
  return 12 * (+m[3] + 1) + pc;
}
export const pcOf = n => (typeof n === 'number' ? ((n % 12) + 12) % 12 : parseNote(n, { allowPc: true }) % 12);
export const nameOf = m => ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'][((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);

export function resolveScale(scale) {
  if (Array.isArray(scale)) return scale.slice();
  const s = SCALES[scale ?? 'ionian'];
  if (!s) throw new Error(`Unknown scale "${scale}". Known: ${Object.keys(SCALES).join(', ')} (or pass an array of semitones)`);
  return s.slice();
}

/** scale degree (0-based, any integer) -> MIDI; degree 0 lands at octave `oct` (C4 = octave 4) */
export function degree(deg, keyPc, scale, oct = 4) {
  const n = scale.length, d = Math.round(deg), o = Math.floor(d / n), i = ((d % n) + n) % n;
  return 12 * (oct + 1) + keyPc + scale[i] + 12 * o + (deg - d); // fractional part = microtonal offset
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** suffix -> interval list relative to the root (root included) */
export function qualityIntervals(minor, suffix = '') {
  let s = suffix.replace(/\s+/g, '');
  let third = minor ? 3 : 4, fifth = 7; const ext = new Set();
  const take = re => { const m = re.exec(s); if (m) { s = s.slice(0, m.index) + s.slice(m.index + m[0].length); return true; } return false; };
  if (take(/^(dim7|°7|o7)/)) { third = 3; fifth = 6; ext.add(9); }
  else if (take(/^(ø7?|m7b5)/)) { third = 3; fifth = 6; ext.add(10); }
  else if (take(/^(dim|°|o)(?![a-z])/)) { third = 3; fifth = 6; }
  else if (take(/^(aug|\+)/)) { fifth = 8; }
  if (take(/^(min|m)(?!aj)/)) third = 3;
  if (take(/(maj|M|Δ)13/)) { ext.add(11); ext.add(14); ext.add(21); }
  else if (take(/(maj|M|Δ)11/)) { ext.add(11); ext.add(14); ext.add(17); }
  else if (take(/(maj|M|Δ)9/)) { ext.add(11); ext.add(14); }
  else if (take(/(maj|M|Δ)7?/)) { ext.add(11); }
  if (take(/^6\/?9|^69/)) { ext.add(9); ext.add(14); }
  if (take(/^13/)) { ext.add(10); ext.add(14); ext.add(21); }
  else if (take(/^11/)) { ext.add(10); ext.add(14); ext.add(17); }
  else if (take(/^9/)) { ext.add(10); ext.add(14); }
  else if (take(/^7/)) { ext.add(third === 3 && fifth === 6 && ext.has(9) ? 9 : 10); }
  else if (take(/^6/)) { ext.add(9); }
  if (take(/sus2/)) third = 2;
  if (take(/sus4?/)) third = 5;
  if (take(/add9|add2/)) ext.add(14);
  if (take(/add11|add4/)) ext.add(17);
  if (take(/add13|add6/)) ext.add(21);
  if (take(/#11|\+11/)) ext.add(18);
  if (take(/b9/)) ext.add(13);
  if (take(/#9/)) ext.add(15);
  if (take(/b13/)) ext.add(20);
  if (take(/b5/)) fifth = 6;
  if (take(/#5/)) fifth = 8;
  s = s.replace(/[()]/g, '');
  if (s.length) throw new Error(`Chord suffix "${suffix}" not understood (left: "${s}")`);
  return [0, third, fifth, ...[...ext].sort((a, b) => a - b)];
}

/**
 * Parse one progression entry into { symbol, root (pitch class 0-11, relative to C), ints, bass (pc or null), none }.
 * keyPc + scale give the context for Roman numerals and diatonic numbers.
 */
export function parseChord(tok, keyPc, scale) {
  if (tok === null || tok === undefined || tok === '-' || tok === 'N.C.' || tok === 'NC') return { symbol: '-', none: true, ints: [], root: keyPc, bass: null };
  if (Array.isArray(tok)) {
    const ms = tok.map(n => parseNote(n)).sort((a, b) => a - b);
    return { symbol: ms.map(nameOf).join(' '), root: ms[0] % 12, ints: ms.map(m => m - ms[0]), bass: null, abs: ms };
  }
  if (typeof tok === 'object') {
    const c = parseChord(tok.chord, keyPc, scale);
    if (tok.bass !== undefined) c.bass = bassPc(tok.bass, keyPc, scale);
    return c;
  }
  let str = String(tok).trim();
  let bass = null;
  const gt = str.indexOf('>');
  if (gt >= 0) { bass = bassPc(str.slice(gt + 1), keyPc, scale); str = str.slice(0, gt); }
  // diatonic numbers: 1, 6, '4^7', '2^9'
  let m = /^(\d+)(?:\^(\d+))?$/.exec(str);
  if (m) {
    const d = +m[1] - 1, size = { 5: 3, 7: 4, 9: 5, 11: 6, 13: 7 }[m[2] ?? '5'] ?? 3, n = scale.length;
    const root = keyPc + scale[((d % n) + n) % n];
    const ints = []; for (let k = 0; k < size; k++) { const dd = d + 2 * k; ints.push(scale[((dd % n) + n) % n] + 12 * Math.floor(dd / n) - scale[((d % n) + n) % n] - 12 * Math.floor(d / n)); }
    return { symbol: str, root: ((root % 12) + 12) % 12, ints, bass };
  }
  // secondary: X/Y with Y roman
  m = /^(.+)\/([b#]*(?:VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i))$/.exec(str);
  if (m && /^[b#]*(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)/.test(m[1])) {
    const target = parseChord(m[2], keyPc, scale);
    const inner = parseChord(m[1], target.root, SCALES.ionian);
    return { ...inner, symbol: str, bass };
  }
  // roman numeral
  m = /^([b#]*)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(.*)$/.exec(str);
  if (m) {
    const idx = ROMAN.indexOf(m[2].toUpperCase()), minor = m[2] === m[2].toLowerCase();
    const sc = scale.length === 7 ? scale : SCALES.ionian;
    let root = keyPc + sc[idx];
    for (const a of m[1]) root += a === '#' ? 1 : -1;
    return { symbol: str, root: ((root % 12) + 12) % 12, ints: qualityIntervals(minor, m[3]), bass };
  }
  // absolute: Ebmaj7, C#m9, D/C
  m = /^([A-G][#b]*)([^/]*)(?:\/([A-G][#b]*))?$/.exec(str);
  if (m) {
    const root = parseNote(m[1], { allowPc: true });
    let suf = m[2], minor = false;
    if (/^(m(?!aj)|min|-)/.test(suf)) { minor = true; suf = suf.replace(/^(min|m|-)/, ''); }
    return { symbol: str, root, ints: qualityIntervals(minor, suf), bass: m[3] ? parseNote(m[3], { allowPc: true }) : bass };
  }
  throw new Error(`Chord "${tok}" not understood. Use Roman numerals (I, vi7, bVII, V/IV, II>I), diatonic numbers (1, '4^7'), names ('Ebmaj7', 'D/C') or MIDI arrays.`);
}
function bassPc(b, keyPc, scale) {
  if (typeof b === 'number') return ((keyPc + scale[(((b - 1) % scale.length) + scale.length) % scale.length]) % 12 + 12) % 12;
  if (/^[A-G]/.test(b)) return parseNote(b, { allowPc: true });
  return parseChord(b, keyPc, scale).root;
}

/** Close-position voicing near `center` (MIDI), voice-led from `prev` if given. Returns sorted MIDI notes. */
export function voiceChord(ch, { center = 62, prev = null, style = 'close', size = 0 } = {}) {
  if (ch.none) return [];
  if (ch.abs) return ch.abs.slice();
  let ints = ch.ints.slice();
  if (size && ints.length > size) ints = ints.slice(0, size);
  if (style === 'shell') ints = ints.filter((x, i) => i === 0 || i === 1 || x === 10 || x === 11 || x === 9);
  let base = 12 * Math.round((center - ch.root - (ints.reduce((a, b) => a + b, 0) / ints.length)) / 12) + ch.root;
  let notes = ints.map(i => base + i);
  if (style === 'spread' && notes.length >= 3) { notes = [notes[0] - 12, ...notes.slice(2), notes[1] + 12].sort((a, b) => a - b); }
  if (style === 'close' && prev && prev.length) {
    // try all inversions within +-1 octave, pick the smallest total movement
    let best = notes, bestCost = Infinity;
    const pmean = prev.reduce((a, b) => a + b, 0) / prev.length;
    for (let inv = 0; inv < notes.length; inv++) for (const shift of [-12, 0, 12]) {
      const cand = notes.map((n, k) => n + shift + (k < inv ? 12 : 0)).sort((a, b) => a - b);
      const cost = cand.reduce((acc, n) => acc + Math.min(...prev.map(p => Math.abs(p - n))), 0) + Math.abs(cand.reduce((a, b) => a + b, 0) / cand.length - pmean) * 0.5 + Math.abs(cand[0] + cand[cand.length - 1] - 2 * center) * 0.15;
      if (cost < bestCost) { bestCost = cost; best = cand; }
    }
    notes = best;
  }
  return notes;
}

/** chord tone token -> MIDI in the register starting at `low` (root placed in [low, low+12)) */
export function chordTone(ch, token, low, next = null) {
  if (ch.none) return null;
  const rootM = low + ((((ch.bass ?? ch.root) - low) % 12) + 12) % 12;
  const realRoot = low + (((ch.root - low) % 12) + 12) % 12;
  const iv = k => (ch.ints[k] ?? ch.ints[ch.ints.length - 1]);
  switch (token) {
    case 'R': return rootM;
    case 'O': return rootM + 12;
    case '3': return realRoot + iv(1);
    case '5': return realRoot + iv(2);
    case '7': return realRoot + (ch.ints.find(x => x >= 9 && x <= 11) ?? 12);
    case '9': return realRoot + (ch.ints.find(x => x >= 13 && x <= 15) ?? 14);
    case 'A': { if (!next || next.none) return rootM - 1; const nr = low + ((((next.bass ?? next.root) - low) % 12) + 12) % 12; return nr - 1 < low ? nr + 11 : nr - 1; }
    default: return null;
  }
}

/** Musical cryptogram: letters -> scale degrees (alphabet index mod scale size). A method, not a motif. */
export function cryptogram(word, scaleSize = 7) {
  return [...String(word).toUpperCase()].filter(c => c >= 'A' && c <= 'Z').map(c => (c.charCodeAt(0) - 65) % scaleSize);
}
