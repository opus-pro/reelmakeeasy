// The harmony check: is the score stable? Pure functions over the composed note list, no audio.
// ReelMakeEasy added this after a score that measured clean (loudness, peaks, phone band) was plainly dissonant: Eb
// lydian over an Eb pedal with F/Eb and Ebmaj7#11 most bars, an aeolian -> lydian switch, a borrowed "surprise" chord,
// and an inharmonic FM-glass lead (ratio 2.32) holding pitches against the chords. Measurement cannot hear, so this
// checks the arithmetic that keeps music consonant, and score.mjs FAILs (exit 3) when it does not hold:
//   mode       the piece's mode is major (ionian), natural minor (aeolian), dorian or mixolydian
//   key        one key and mode for the whole piece; a section may move only to the relative major/minor
//   chords     no #11, b9, #9, altered, augmented, diminished or half-diminished chord (a tritone or b9 over the root);
//              a 7th or 9th chord is fine when all its tones are in the key (dorian's IV9, a V7)
//   slash      a slash chord's bass is one of its own chord tones (a pedal only under chords that contain it)
//   outside    a chord outside the key that is not a plain borrowing from the parallel major/minor
//   outside    every chord is in the key: no chord borrowed from the parallel major/minor (that is a mode switch).
//              Two exceptions: the major V / V7 of a minor (aeolian or dorian) key, the plain minor-key cadence, and
//              a minor piece's last chord on its tonic's major (a Picardy third).
//   keyless    a pitched note that sounds longer than a tick needs a key: a section with no key holds no pitch
//   tuning     whole semitones only (a fractional MIDI note is out of tune)
//   key notes  every pitched note is in the mode (or a tone of the minor key's V or the Picardy chord)
//   nonchord   every note is a tone of the chord sounding then (or its plain 9th/11th): no passing or neighbour tones
//              at all, on any beat (the owner's rule: no dissonance, ever)
//   bass       a bass note (a bass instrument, or any note below C3) is the chord's root or
//              fifth (or the slash chord's own bass)
//   clashes    two voices sounding a minor 2nd / major 7th / tritone apart (any octave) for 0.15 s or more, unless both
//              are tones of the chord symbol sounding then (a maj7's own 7th, a m9's own 9th, a V7's own tritone);
//              an added tension is not a chord tone here
//   inharmonic glass, modal, bar, plate, membrane, ceramic, wood, rattle, shing, an fm voice with a non-integer
//              ratio: never holding a pitch longer than 0.15 s (unpitched percussion and short UI ticks only). The
//              bell instrument is exempt: its partials read as a bell (the owner approved it in two scores)
// Cue sounds (pitched hits on the sfx bus) count like any other note.

export const ALLOWED_MODES = ['ionian', 'major', 'aeolian', 'minor', 'dorian', 'mixolydian'];
const MODE_SETS = {
  ionian: [0, 2, 4, 5, 7, 9, 11], aeolian: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10],
};
const ALIAS = { major: 'ionian', minor: 'aeolian' };
/** inharmonic held longer than this (s) fails; sustained clashes shorter than this do not count */
export const HOLD_SEC = 0.15;
const FLATS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'], SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
let PC = FLATS;   // spelled with sharps in a sharp key (set per check)
const SHARP_TONICS = new Set([2, 4, 6, 7, 9, 11, 1]);   // major-scale sharp keys D E F# G A B C# (a minor/modal key: its relative major's)
const pcName = pc => PC[((pc % 12) + 12) % 12];
const noteName = m => pcName(Math.round(m)) + (Math.floor(Math.round(m) / 12) - 1);
const r3 = x => Math.round(x * 1000) / 1000;
const mod12 = x => ((Math.round(x) % 12) + 12) % 12;
const pcsOf = (keyPc, scale) => new Set(scale.map(x => mod12(keyPc + x)));

// ------------------------------------------------------------------ instruments
const MODAL_FAMILY = new Set(['glass', 'modal', 'bar', 'membrane', 'ceramic', 'wood', 'rattle']);
const MODAL_DEFAULT_RATIOS = { free: [1, 2.756, 5.404, 8.933], tuned: [1, 4, 10], glass: [1, 2.32, 4.25, 6.63], membrane: [1, 1.594], wood: [1, 2.756], ceramic: [1, 2.42] };
const MODAL_DEFAULT_DECAY = { wood: 0.08, ceramic: 0.35, membrane: 0.5, rattle: 0.05 };
const isInt = r => Math.abs(r - Math.round(r)) < 0.01;
const harmonicRatio = r => r > 0 && (isInt(r) || isInt(1 / r));
/** the instruments whose events carry notes that are part of the harmony (the composer's tonal voices + 808 bass) */
export const BASS_INST = new Set(['sub', 'sawBass', 'e808', 'reese', 'acid', 'wobble', 'logdrum', 'triangle', 'upright']);
export const CHORD_INST = new Set(['pad', 'stab', 'drone', 'choir', 'organ']);
/** voices whose sounding time adds a release tail after the gate (soundingSec) */
const RELEASE_TAIL = new Set(['pad']);
/** pitched percussion whose note is a drum tuning, not a line: not part of the harmony */
const DRUM_TUNING = new Set(['tom', 'conga', 'taiko', 'kick', 'snare', 'rim', 'cowbell', 'hat', 'ride']);

/** Why an instrument's partials are not a harmonic series, or null when they are. */
export function inharmonicWhy(inst, p = {}) {
  // the bell is a tuned instrument whose inharmonic partials read as a bell, not as a second pitch
  if (inst === 'bell') return null;
  if (inst === 'fm') { const r = p.ratio ?? 1; return harmonicRatio(r) ? null : `fm ratio ${r} (not an integer)`; }
  if (inst === 'shing') { const r = p.ratio ?? 1.41; return harmonicRatio(r) ? null : `shing FM ratio ${r} (not an integer)`; }
  if (!MODAL_FAMILY.has(inst)) return null;
  if (inst === 'bar' && p.tuned) return null;
  let ratios = Array.isArray(p.ratios) ? p.ratios : typeof p.ratios === 'string' ? MODAL_DEFAULT_RATIOS[p.ratios] : null;
  if (!ratios && p.shape != null) return `${inst} shape '${p.shape}' (an object's modes)`;
  if (!ratios) ratios = MODAL_DEFAULT_RATIOS[p.material ?? (inst === 'modal' || inst === 'bar' ? 'free' : inst === 'rattle' ? 'wood' : inst)] ?? MODAL_DEFAULT_RATIOS.free;
  return ratios.every(harmonicRatio) ? null : `${inst} modes ${ratios.slice(0, 4).join(':')}${p.material ? ` (${p.material})` : ''}`;
}

/** How long a note audibly holds its pitch (s): the gate for sustained voices, the decay to about -20 dB for struck ones. */
export function soundingSec(inst, p = {}, dur = 0.25) {
  const d = dur > 0 ? dur : 0.25, k = 2.3;   // 2.3 time constants = -20 dB
  switch (inst) {
    case 'bell': return Math.min(d, k * (p.decay ?? 0.357));
    case 'fm': return Math.min(d + (p.release ?? 0.1), k * (p.decay ?? 1));
    case 'pluck': return k * (p.decay ?? 0.11);
    case 'blip': return Math.min(d, k * (p.decay ?? 0.045));
    case 'arpSaw': return k * (p.decay ?? 0.07);
    case 'pad': return d + (p.release ?? 0.6) * 0.5;
    case 'shing': return 0.92 * (p.dur ?? (dur > 0 ? dur : 0.6));   // exp(-x / (0.4 dur)) to -20 dB
    case 'rattle': { const e = Math.min(0.95, Math.max(0.05, p.e ?? 0.55)); return (p.first ?? 0.09) / (1 - e) + k * (p.decay ?? 0.05); }
    default:
      if (MODAL_FAMILY.has(inst)) return k * (p.decay ?? MODAL_DEFAULT_DECAY[p.material ?? inst] ?? 1.2);
      return d;
  }
}

/** Is this event part of the harmony? Every event that carries a note (tonal voices, 808 and log-drum bass, the modal
 *  family whatever its kind: wood, ceramic, rattle ...) or rings a set frequency (a modal voice's f, shing); never drum
 *  tunings or noise. */
export function isPitchedEvent(e, kind) {
  if (DRUM_TUNING.has(e.inst) || ['vinyl', 'hiss', 'wind'].includes(e.inst)) return false;
  if (e.note !== undefined || (Array.isArray(e.notes) && e.notes.length)) return true;
  return e.params?.f != null && (MODAL_FAMILY.has(e.inst) || e.inst === 'shing') || (e.inst === 'shing');
}
/** The MIDI pitches an event sounds (a modal voice's f overrides its note; shing rings f, 1800 Hz by default). */
export function eventPitches(e) {
  const ftom = f => 69 + 12 * Math.log2(f / 440);
  if (e.inst === 'shing') return [ftom(e.params?.f ?? 1800)];
  if (MODAL_FAMILY.has(e.inst) && e.params?.f != null) return [ftom(e.params.f)];
  return (Array.isArray(e.notes) && e.notes.length ? e.notes : [e.note]).filter(m => m != null);
}

// ------------------------------------------------------------------ chords
/** A chord's pitch classes, root and the reasons it is unstable (empty when it is a plain triad / 7th / add9 / sus). */
export function chordInfo(ch) {
  if (!ch || ch.none) return { none: true, pcs: new Set(), flags: [] };
  let root, rel;
  if (ch.abs) { const ms = ch.abs.slice().sort((a, b) => a - b); root = mod12(ms[0]); rel = new Set(ms.map(m => mod12(m - ms[0]))); }
  else { root = mod12(ch.root); rel = new Set(ch.ints.map(mod12)); }
  const pcs = new Set([...rel].map(x => mod12(root + x)));
  // a MIDI array is named by its notes (a 'Bb5' there is a note, not a b5): only the intervals judge it
  const flags = [], sym = ch.abs ? ch.abs.map(noteName).join(' ') : String(ch.symbol ?? ''), named = ch.abs ? '' : quality(sym);
  if (/#11|\+11/.test(named)) flags.push('#11');
  if (/b9/.test(named)) flags.push('b9');
  if (/#9/.test(named)) flags.push('#9');
  if (/alt/i.test(named)) flags.push('altered');
  if (/dim|°|ø|m7b5|(^|[^a-z])o7?$/.test(named)) flags.push('diminished');
  if (/aug|\+(?!11)|#5|b13|b5/.test(named)) flags.push('augmented or altered fifth');
  if (!flags.length) {   // the intervals say the same when the symbol does not (a Roman numeral, a MIDI array)
    if (rel.has(6)) flags.push(rel.has(3) && !rel.has(7) ? 'diminished' : 'tritone over the root (#11 / b5)');
    if (rel.has(1)) flags.push('b9 over the root');
    if (rel.has(3) && rel.has(4)) flags.push('#9 (minor and major third)');
    if (rel.has(8) && rel.has(4) && !rel.has(7)) flags.push('augmented');
  }
  const bass = ch.bass != null ? mod12(ch.bass) : null;
  return { root, pcs, rel, bass, flags, slashBad: bass != null && !pcs.has(bass), symbol: sym || [...pcs].map(pcName).join(' ') };
}

// ------------------------------------------------------------------ the check
/**
 * checkHarmony(input) -> { status: 'PASS' | 'FAIL', summary, key, mode, counts, issues, borrowed (each is also an 'outside' issue), clashes }
 * input: {
 *   beatsPerBar, stepsPerBar, beatSec, start (s, the grid's 0), duration (s),
 *   sections: [{ name, at, end, keyPc (0-11 | null), mode (name | number[] | null), scale (number[] | null) }],
 *   chords:   [{ t0, t1, section, chord: { symbol, root, ints, bass, none, abs } }]   (theory.parseChord shape)
 *   notes:    [{ voice, inst, t, dur, midi, vel, role?: 'bass'|'chord'|'melody', inharmonic?: string|null, hold?: s, cue?, hz?: true (pitch set in Hz) }]
 * }
 * Every list in the result is capped; counts are whole.
 */
export function checkHarmony(input) {
  const { sections = [], chords = [], notes = [] } = input;
  const beatsPerBar = input.beatsPerBar ?? 4, stepsPerBar = input.stepsPerBar ?? 16, beatSec = input.beatSec;
  const start = input.start ?? 0, DUR = input.duration ?? Infinity;
  const spb = stepsPerBar / beatsPerBar, stepSec = beatSec / spb, eighth = beatSec / 2;
  const ringMax = eighth * 1.1 + 1e-4;   // "no longer than an 8th", with room for a struck voice's tail
  const issues = { mode: [], key: [], keyless: [], chords: [], slash: [], outside: [], tuning: [], keyNotes: [], nonchord: [], bass: [], inharmonic: [] };
  const counts = Object.fromEntries(Object.keys(issues).map(k => [k, 0]));
  const add = (k, row, cap = 12) => { counts[k]++; if (issues[k].length < cap) issues[k].push(row); };
  const keyed = sections.filter(s => s.keyPc != null && s.scale);
  PC = FLATS;
  if (!notes.length) return finish({ nothing: true });

  // ---- mode and key: one key and mode for the piece (a section may sit on the relative major/minor)
  const modeName = s => {
    if (typeof s.mode === 'string') return ALIAS[s.mode] ?? s.mode;
    const hit = Object.entries(MODE_SETS).find(([, set]) => set.length === s.scale.length && set.every((x, i) => x === s.scale[i]));
    return hit ? hit[0] : `[${s.scale.join(',')}]`;
  };
  let home = null, homeMode = null;
  if (keyed.length) {
    // the piece's key: the key and mode that cover the most time (a short intro in another mode is the change, not the key)
    const span = {}; for (const s of keyed) { const id = `${s.keyPc}|${modeName(s)}`; span[id] = (span[id] ?? 0) + (s.end - s.at); }
    const homeId = Object.entries(span).sort((a, b) => b[1] - a[1])[0][0];
    home = keyed.find(s => `${s.keyPc}|${modeName(s)}` === homeId); homeMode = modeName(home);
    const homePcs = pcsOf(home.keyPc, home.scale);
    PC = SHARP_TONICS.has(mod12(home.keyPc - ({ dorian: 2, mixolydian: 7, aeolian: 9 }[homeMode] ?? 0))) ? SHARPS : FLATS;
    const seenMode = new Set();
    for (const s of keyed) {
      const m = modeName(s);
      if (!MODE_SETS[m] && !seenMode.has(m)) { seenMode.add(m); add('mode', { section: s.name, mode: m, msg: `${pcName(s.keyPc)} ${m} is not an allowed mode (major/ionian, minor/aeolian, dorian, mixolydian)` }); }
      if (s === home) continue;
      const same = s.keyPc === home.keyPc && m === homeMode;
      const relative = (['ionian', 'aeolian'].includes(m) && ['ionian', 'aeolian'].includes(homeMode) && m !== homeMode && setEq(pcsOf(s.keyPc, s.scale), homePcs));
      if (!same && !relative) add('key', { section: s.name, at: r3(s.at), msg: `section "${s.name}" is ${pcName(s.keyPc)} ${m}, the piece ${pcName(home.keyPc)} ${homeMode}: one key and mode for the whole piece (a section may move only to the relative major/minor)` });
    }
  }

  // ---- chords: stable, and in the key (no borrowing: a borrowed chord is a mode switch)
  const spans = chords.map(c => ({ ...c, info: chordInfo(c.chord) }));
  const secOf = t => { let s = sections[0] ?? {}; for (const x of sections) if (t >= x.at - 1e-6) s = x; return s; };
  const parallel = keyPc => [pcsOf(keyPc, MODE_SETS.ionian), pcsOf(keyPc, MODE_SETS.aeolian)];
  const seenChord = new Set(), borrowed = [];
  for (const sp of spans) {
    const ci = sp.info; if (ci.none) continue;
    const s = secOf(sp.t0 + 1e-6);
    const id = `${s.name}|${ci.symbol}|${ci.bass}`; const first = !seenChord.has(id); seenChord.add(id);
    const where = { t: r3(sp.t0), section: s.name, chord: ci.symbol };
    if (ci.flags.length) { if (first) add('chords', { ...where, msg: `${ci.symbol}: ${ci.flags.join(', ')}` }); else counts.chords++; }
    if (ci.slashBad) { if (first) add('slash', { ...where, msg: `${ci.symbol}: the bass ${pcName(ci.bass)} is not a tone of the chord (${[...ci.pcs].map(pcName).join(' ')})` }); else counts.slash++; }
    if (s.keyPc == null || !s.scale) continue;
    const scale = pcsOf(s.keyPc, s.scale), inKey = [...ci.pcs].every(p => scale.has(p)), m = modeName(s);
    // the minor key's own cadence: a major V or V7 on the fifth of an aeolian / dorian key (its 3rd is the leading tone)
    sp.dominant = !inKey && ['aeolian', 'dorian'].includes(m) && ci.root === mod12(s.keyPc + 7) && ci.rel.has(4) && ci.rel.has(7)
      && [...ci.rel].every(x => [0, 4, 7, 10].includes(x)) && (ci.bass == null || ci.bass === ci.root);
    // a minor piece may end on its tonic's major chord (a Picardy third): the last chord only, root on the tonic
    sp.picardy = !inKey && sp === spans[spans.length - 1] && ['aeolian', 'dorian'].includes(m) && ci.root === s.keyPc
      && ci.rel.has(4) && ci.rel.has(7) && [...ci.pcs].every(p => parallel(s.keyPc)[0].has(p));
    if (inKey || sp.dominant || sp.picardy) continue;
    const from = [...ci.pcs].every(p => parallel(s.keyPc)[0].has(p)) ? 'parallel major' : [...ci.pcs].every(p => parallel(s.keyPc)[1].has(p)) ? 'parallel minor' : null;
    if (from && first) borrowed.push({ ...where, from });
    if (first) add('outside', { ...where, msg: `${ci.symbol} (${[...ci.pcs].map(pcName).join(' ')}) is outside ${pcName(s.keyPc)} ${m}${from ? ` (borrowed from the ${from}: a mode switch)` : ''}: use the key's own chords` });
    else counts.outside++;
  }
  spans.sort((a, b) => a.t0 - b.t0);
  const spanAt = t => { let lo = 0, hi = spans.length - 1, best = null; while (lo <= hi) { const m = (lo + hi) >> 1; if (spans[m].t0 <= t + 1e-6) { best = spans[m]; lo = m + 1; } else hi = m - 1; } return best && t < best.t1 + 1e-6 ? best : null; };

  // ---- notes: where each sits, how long it rings, and its neighbours in the same voice
  const rows = [], seenNote = new Set();
  for (const n of notes) {
    // above MIDI 127 (12.5 kHz) a note is not heard as a pitch (the modal voices drop partials past Nyquist)
    if (!(n.t < DUR - 1e-6) || n.midi == null || !Number.isFinite(n.midi) || n.midi > 127) continue;
    const nid = `${n.voice}|${r3(n.t)}|${r3(n.midi)}`; if (seenNote.has(nid)) continue; seenNote.add(nid);
    const hold = Math.max(n.hold ?? 0, n.dur ?? 0);
    // a pad's release tail past its gate is the crossfade into the next chord, not a held pitch: it rings, but a clash
    // is timed on the gate (a struck voice's ring is its sustain, so it is timed on the ring)
    const susEnd = n.t + Math.max(RELEASE_TAIL.has(n.inst) ? n.dur ?? hold : hold, 0.01);
    rows.push({ ...n, hold, end: Math.min(DUR, susEnd) });
  }
  const byVoice = {};
  for (const r of rows) (byVoice[r.voice] ??= []).push(r);
  for (const list of Object.values(byVoice)) {
    list.sort((a, b) => a.t - b.t);
    // the same voice's notes just before and just after (within a beat of this one's start / end): a step from both
    const times = [...new Set(list.map(r => r3(r.t)))];
    const at = new Map(times.map(t => [t, list.filter(r => r3(r.t) === t)]));
    for (const r of list) {
      const i = times.indexOf(r3(r.t)), prev = at.get(times[i - 1]) ?? [], next = at.get(times[i + 1]) ?? [];
      const step = q => { const d = Math.abs(q.midi - r.midi); return d >= 1 - 1e-6 && d <= 2 + 1e-6; };
      const prevEnd = Math.max(...prev.map(q => q.t + (q.dur ?? 0)), -Infinity), nextT = next[0]?.t ?? Infinity;
      r.stepwise = r.t - prevEnd <= beatSec + 1e-4 && nextT - (r.t + (r.dur ?? 0)) <= beatSec + 1e-4 && prev.some(step) && next.some(step);
    }
  }
  const half = spb % 2 === 0 ? spb / 2 : null;
  for (const n of rows) {
    // a note's place is the grid step it is nearest (an offset, swing or humanize push does not move it off a beat)
    const k = Math.round((n.t - start) / stepSec), kk = ((k % spb) + spb) % spb;
    const onBeat = kk === 0, weak16 = !onBeat && (half == null || kk % half !== 0);
    const long = n.hold > ringMax;
    // no passing or neighbour tones at all: every note is a chord tone or the chord's own colour (the owner's rule)
    const passing = false;
    const sp = spanAt(n.t + 1e-4), ci = sp && !sp.info.none ? sp.info : null, s = secOf(n.t + 1e-6);
    const pc = mod12(n.midi);
    const scale = s.keyPc != null && s.scale ? pcsOf(s.keyPc, s.scale) : null;
    const chordTone = !!ci && (ci.pcs.has(pc) || ci.bass === pc);
    const keyOk = scale ? scale.has(pc) || ((sp?.dominant || sp?.picardy) && ci.pcs.has(pc)) : true;
    const tension = !!ci && !chordTone && keyOk && availableTension(ci, pc);
    const bassRole = n.role === 'bass' || n.midi < 48;
    Object.assign(n, { pc, onBeat, weak16, long, chordTone, tension, passing, ci });
    const at = `${r3(n.t)} s ${n.voice} ${noteName(n.midi)}${ci ? ` over ${ci.symbol}` : ''}`;
    const row = extra => ({ t: r3(n.t), voice: n.voice, note: noteName(n.midi), ...extra });
    if (!n.hz && Math.abs(n.midi - Math.round(n.midi)) > 0.02)
      add('tuning', row({ msg: `${at}: MIDI ${r3(n.midi)} is ${Math.round((n.midi - Math.round(n.midi)) * 100)} cents off the note; whole semitones only` }));
    if (!scale && n.hold > HOLD_SEC)
      add('keyless', row({ msg: `${at}: holds a pitch ${r3(n.hold)} s in section "${s.name ?? '?'}", which sets no key: set the piece's key and mode` }));
    if (!keyOk && !passing)
      add('keyNotes', row({ msg: `${at}: ${pcName(pc)} is outside ${pcName(s.keyPc)} ${modeName(s)}${weak16 ? '' : onBeat ? ' (on a beat)' : " (on the 'and')"}` }));
    const why = () => onBeat ? 'on a beat' : long ? `rings ${r3(n.hold)} s` : !weak16 ? "on the 'and'" : 'not a step from its neighbours';
    if (bassRole && ci) {
      if (!passing && ![ci.root, mod12(ci.root + 7), ci.bass].includes(pc))
        add('bass', row({ msg: `${at}: a bass note (${why()}) that is not the root or fifth` }));
    } else if (ci && !chordTone && !tension && !passing)
      add('nonchord', row({ msg: `${at}: ${why()}, neither a chord tone (${[...ci.pcs].map(pcName).join(' ')}) nor its plain 9th/11th` }));
    if (n.inharmonic && n.hold > HOLD_SEC)
      add('inharmonic', row({ msg: `${at}: ${n.inharmonic} holds a pitch ${r3(n.hold)} s (> ${HOLD_SEC} s)` }));
  }

  // ---- clashes: sustained m2 / M7 / tritone between two voices, unless both are tones of the chord symbol sounding
  rows.sort((a, b) => a.t - b.t);
  const clashes = [], seenPair = new Set(); let clashCount = 0;
  const active = [];
  for (const b of rows) {
    for (let i = active.length - 1; i >= 0; i--) if (active[i].end <= b.t + 1e-6) active.splice(i, 1);
    for (const a of active) {
      if (a.voice === b.voice) continue;
      const ic = mod12(Math.abs(a.midi - b.midi)), iv = ic === 1 ? 'minor 2nd' : ic === 11 ? 'major 7th' : ic === 6 ? 'tritone' : null;
      if (!iv) continue;
      const overlap = Math.min(a.end, b.end) - b.t;
      if (overlap < HOLD_SEC) continue;
      if (a.passing && b.t - a.t > 1e-3) continue;   // a passing tone moving on
      if (b.passing) continue;
      const ci = spanAt(b.t + 1e-4)?.info;
      // the chord's own colour: a maj7's 7th, a m9's 9th, a V7's tritone (a stable chord, both notes in its symbol)
      if (ci && !ci.none && !ci.flags.length && !ci.slashBad && a.chordTone && b.chordTone) continue;
      const pid = `${b.t}|${[a.voice, b.voice].sort().join('|')}|${[a.midi, b.midi].sort().join('|')}`; if (seenPair.has(pid)) continue; seenPair.add(pid);
      clashCount++;
      const sev = overlap * Math.sqrt(Math.max(0.05, a.vel ?? 0.8) * Math.max(0.05, b.vel ?? 0.8));
      clashes.push({ t: r3(b.t), dur: r3(overlap), interval: iv, voices: [a.voice, b.voice], notes: [noteName(a.midi), noteName(b.midi)], chord: ci && !ci.none ? ci.symbol : null, sev });
    }
    if (b.end > b.t) active.push(b);
  }
  clashes.sort((x, y) => y.sev - x.sev);
  const worst = clashes.slice(0, 10).map(({ sev, ...c }) => ({ ...c, msg: `${c.t} s ${c.voices[0]} ${c.notes[0]} vs ${c.voices[1]} ${c.notes[1]}: ${c.interval} for ${c.dur} s${c.chord ? ` over ${c.chord}` : ''}` }));
  const byInterval = clashes.reduce((o, c) => ((o[c.interval] = (o[c.interval] ?? 0) + 1), o), {});
  return finish({ clashCount, worst, byInterval, borrowed, home, homeMode, pitched: rows.length });

  function finish(o) {
    const clashN = o.clashCount ?? 0;
    const fails = Object.values(counts).reduce((a, b) => a + b, 0) + clashN;
    const status = fails ? 'FAIL' : 'PASS';
    const parts = [];
    const lab = { mode: 'mode refused', key: 'key/mode change', keyless: 'pitch held with no key', chords: 'unstable chord', slash: 'slash bass not in the chord', outside: 'chord outside the key', tuning: 'note off the semitone', keyNotes: 'note outside the key', nonchord: 'non-chord tone that is not a passing tone', bass: 'bass note not root/fifth', inharmonic: 'inharmonic note holding a pitch' };
    const plural = { mode: 'modes refused', key: 'key/mode changes', keyless: 'pitches held with no key', chords: 'unstable chords', slash: 'slash basses not in the chord', outside: 'chords outside the key', tuning: 'notes off the semitone', keyNotes: 'notes outside the key', nonchord: 'non-chord tones that are not passing tones', bass: 'bass notes not root/fifth', inharmonic: 'inharmonic notes holding a pitch' };
    for (const [k, n] of Object.entries(counts)) if (n) parts.push(`${n} ${n > 1 ? plural[k] : lab[k]}`);
    if (clashN) parts.push(`${clashN} sustained clash${clashN > 1 ? 'es' : ''} (${Object.entries(o.byInterval).map(([k, v]) => `${v} ${k}`).join(', ')}; worst ${o.worst[0].msg})`);
    const keyStr = o.home ? `${pcName(o.home.keyPc)} ${o.homeMode}` : 'no key';
    const summary = o.nothing ? 'nothing pitched to check'
      : status === 'PASS' ? `${keyStr}: ${o.pitched} pitched notes, every chord stable and in the key, no sustained clash, no note outside the key`
      : `${keyStr}: ${parts.join('; ')}`;
    return { status, summary, key: o.home ? pcName(o.home.keyPc) : null, mode: o.homeMode ?? null, pitched: o.pitched ?? 0, counts: { ...counts, clashes: clashN }, issues, clashes: { count: clashN, byInterval: o.byInterval ?? {}, worst: o.worst ?? [] }, borrowed: o.borrowed ?? [] };
  }
}
/** A plain extension of a stable chord, heard as part of it (m9, maj9, 6/9, m11, 13): the 9th over any triad, the 11th
 *  over a minor chord, the 6th/13th over a major or sus chord, the 7th the chord's quality implies. It is still not a
 *  chord tone in the clash check. Never b9, #9, #11, b13 or the 11th over a
 *  major third (it sits a minor 9th above the third). */
export function availableTension(ci, pc) {
  if (!ci || ci.none || ci.flags.length || ci.slashBad) return false;
  const r = mod12(pc - ci.root), rel = ci.rel, maj = rel.has(4), min = rel.has(3) && !maj;
  switch (r) {
    case 2: return !rel.has(1) && !rel.has(3) || min;          // the 9th (a m9's 9th sits under its minor third: fine)
    case 5: return min || (!maj && !rel.has(3));                 // the 11th: minor and sus chords only
    case 9: return !rel.has(8) && !min;                          // the 6th / 13th (not over a minor chord: a tritone with its 3rd)
    case 10: return !rel.has(11);                                // the b7 over a chord without a major 7th
    case 11: return maj && !rel.has(10);                         // the major 7th over a major chord
    default: return false;
  }
}
/** A chord symbol's quality: the root ('Gb', 'bVII') and the bass ('/Eb', '>I') removed, so 'Gb9' is a 9th, not a b9. */
function quality(sym) {
  return sym.replace(/[/>].*$/, '').replace(/^[A-G][#b]?/, '').replace(/^[b#]*(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)/, '');
}
function setEq(a, b) { return a.size === b.size && [...a].every(x => b.has(x)); }
