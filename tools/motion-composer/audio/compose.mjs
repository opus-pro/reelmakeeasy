// The arranger: turns a project music.mjs (data + optional step(ctx)) plus build/cues.json into stereo audio.
// Pipeline: timeline -> sections -> harmony -> per-voice grid scheduling (swing, humanize, polymeter, fills)
// -> hold notes, motif, explicit notes, step(ctx) -> cue sound design -> render into buses (beat | music | sfx)
// -> per-voice inserts -> delay + reverb per bus -> sidechain duck -> bus effects -> master chain
// -> ending (ring | button | loop) -> control signals for the picture.
// Determinism: every random choice comes from rng(seed ^ hash(name)); no Math.random, no Date.
// Schema reference: node tools/score.mjs --help (kept in sync with this file).

import { SR, S, Bus, rng, hash, reverb, delayLine, biquad, clamp, soft, readAt, mtof, lp1, hp1 } from './dsp.mjs';
import { INST } from './instruments.mjs';
import { parseNote, pcOf, resolveScale, degree, parseChord, voiceChord, chordTone, nameOf } from './theory.mjs';
import { VEL, RESTS, PITCH_TOKENS, expandGrid, meterInfo, swingOffset, euclid } from './rhythm.mjs';
import { defaultCue, BUS_KINDS } from './cues.mjs';
import { BUS_FX, swell, applyInserts } from './fx.mjs';
import { checkHarmony, isPitchedEvent, eventPitches, soundingSec, inharmonicWhy, BASS_INST as HARMONY_BASS, CHORD_INST } from './harmony.mjs';

const BASS_INST = new Set(['sub', 'sawBass', 'e808', 'reese', 'acid', 'wobble', 'logdrum', 'triangle', 'upright']);
const UNPITCHED_TEXTURE = new Set(['vinyl', 'hiss', 'wind']);
/** cue kinds that only drive the picture (no sound unless music.mjs `cues` voices them) */
export const PICTURE_ONLY = new Set(['transition', 'flash']);
// keys the composer consumes; everything else in a voice / pattern object is passed to the instrument
const COMPOSER_KEYS = new Set(['inst', 'type', 'gain', 'pan', 'send', 'dsend', 'bus', 'octave', 'low', 'swing', 'human', 'offset', 'gate', 'duck', 'mono', 'choke',
  'minEnergy', 'maxEnergy', 'notes', 'voicing', 'center', 'size', 'steps', 'vel', 'velMap', 'velHold', 'phase', 'rotate', 'transpose', 'grid', 'hold', 'legato',
  'notesReset', 'arpOctaves', 'every', 'bars', 'fx', 'harmonics', 'porta']);
// instruments that take `from` (a glide start): the voice key `porta` feeds them the previous note
const PORTA_INST = new Set(['acid', 'e808', 'logdrum', 'pulse']);
const ROMANISH = /^[b#]*(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(?![a-z]*[A-G])|^\d/;

export class MusicError extends Error {}
const fail = msg => { throw new MusicError(msg); };

/** Load ./music.mjs (object, or function ({ sheet, T, lib }) => object). Named export `step` is merged in. */
export async function loadSpec(url, ctx) {
  const mod = await import(url);
  let spec = mod.default;
  if (typeof spec === 'function') spec = await spec(ctx);
  if (!spec || typeof spec !== 'object') fail('music.mjs must `export default` an object (or a function returning one).');
  if (mod.step && !spec.step) spec = { ...spec, step: mod.step };
  return normalizeSpec(spec);
}

/** Accept both spellings: voices{inst} or instruments{type} (template / 03 §4.1), scale or mode, stepsPerBar or steps. */
export function normalizeSpec(raw) {
  const spec = { ...raw };
  if (spec.tempo != null && typeof spec.tempo !== 'number')
    fail('music.mjs `tempo` maps (ramps, ritardando) are engine phase P2: cues are in seconds at one bpm. Use one bpm (config.bpm) and make the accelerando with cut density and arrangement (music-direction.md §3).');
  if (typeof spec.tempo === 'number' && spec.bpm == null) spec.bpm = spec.tempo;
  const src = spec.voices ?? spec.instruments ?? {};
  if (typeof src !== 'object' || Array.isArray(src)) fail('music.mjs `instruments` (or `voices`) must be an object { <voice name>: { type: <instrument>, ...parameters } }.');
  const voices = {};
  for (const [k, v] of Object.entries(src)) {
    if (!v || typeof v !== 'object') fail(`voice "${k}" must be an object { type: <instrument>, ... }`);
    const inst = v.inst ?? v.type;
    voices[k] = { ...v, inst };
    if (!v.inst) delete voices[k].type;           // `type` named the instrument; with `inst` it stays a parameter
  }
  spec.voices = voices;
  spec.scale = spec.scale ?? spec.mode ?? null;
  spec.stepsPerBar = spec.stepsPerBar ?? spec.steps ?? null;
  return spec;
}

/** Time base shared with the picture: bpm counts quarter notes; bar length follows the meter. */
export function timeBase(spec, sheet) {
  const bpm = spec.bpm ?? sheet?.bpm;
  if (!(bpm > 0)) fail('No tempo: set bpm in reel.config.mjs (music.mjs reads config.bpm; it also reaches build/cues.json).');
  if (spec.bpm && sheet?.bpm && Math.abs(spec.bpm - sheet.bpm) > 1e-6)
    fail(`music.mjs bpm ${spec.bpm} differs from build/cues.json bpm ${sheet.bpm}. The picture is cut to the config's grid: change one (and write build/cues.json again) so they match.`);
  const meter = meterInfo(spec.meter ?? sheet?.meter ?? '4/4', spec.stepsPerBar);
  if (sheet?.beatsPerBar && Math.abs(sheet.beatsPerBar - meter.beatsPerBar) > 1e-6)
    fail(`music.mjs meter (${meter.label}, ${meter.beatsPerBar} beats/bar) differs from the picture's (${sheet.meter}, ${sheet.beatsPerBar} beats/bar). Set the meter once in reel.config.mjs.`);
  const beatSec = 60 / bpm, barSec = meter.beatsPerBar * beatSec, stepSec = barSec / meter.stepsPerBar;
  const T = { bpm, beat: n => n * beatSec, bar: n => n * barSec, s16: n => n * beatSec / 4, step: n => n * stepSec, meter, beatsPerBar: meter.beatsPerBar, stepsPerBar: meter.stepsPerBar };
  return { bpm, meter, beatSec, barSec, stepSec, T };
}

export const lib = { euclid, parseNote, nameOf, mtof, degree, parseChord, expandGrid };

/**
 * compose(spec, sheet, opts) -> { L, R, info, signals }
 *  spec: normalised music.mjs (loadSpec / normalizeSpec). sheet: build/cues.json or null (sketch mode: sections need bars).
 *  opts: { ending, audio, durOverride, onlyBus: 'beat'|'music'|'sfx', allowNoMusic, signalRate,
 *          solo: [names], mute: [names],  (names: music.mjs voices, 'cues', 'inst:<instrument>'; ducking still
 *          follows the full arrangement, so a muted kick keeps pumping the pads as it does in the mix)
 *          probe: true }  also returns probe { <voice | 'cues' | 'inst:<name>'>: Float32Array mono } = each group's
 *          dry signal after its inserts and harmonics, before sends, duck, bus fx and the master chain. score.mjs
 *          splits the phone-band QC by voice with it; the groups sum to the dry mix.
 */
export function compose(spec, sheet, opts = {}) {
  spec = spec.voices && spec.scale !== undefined ? spec : normalizeSpec(spec);
  const warn = [], log = [];
  const tb = timeBase(spec, sheet), { bpm, meter, beatSec, barSec, stepSec, T } = tb;
  const seed = (spec.seed ?? 1) >>> 0;
  const audio = { ...(sheet?.audio || {}), ...(opts.audio || {}) };
  const ending = opts.ending ?? audio.ending ?? spec.ending ?? 'ring';
  if (!['ring', 'button', 'loop'].includes(ending)) fail(`audio.ending must be 'ring', 'button' or 'loop' (got ${ending})`);
  const start = spec.start ?? 0;

  // ------------------------------------------------------------ sections
  const pic = sheet?.sections ?? [];
  let list = spec.sections;
  if (list === 'picture' || (list && list.from === 'picture')) {
    if (!pic.length) fail("music.mjs sections: 'picture' mirrors the picture sections, but there is no build/cues.json (write it from the plan, or give the sections bars).");
    const each = typeof list === 'object' ? (list.each || {}) : {};
    list = pic.map((s, i) => ({ ...each, name: s.label || s.scene || `s${i}`, picture: i }));
  }
  if (list == null) fail("music.mjs has no `sections`. Write [{ name, bars, energy, grid, prog }] covering the reel, or sections: 'picture' to mirror the picture sections.");
  if (!Array.isArray(list)) fail("music.mjs `sections` must be an array (or the string 'picture').");
  if (!list.length) {
    if (opts.allowNoMusic) list = [{ name: '(cues only)', at: 0, until: 'end', grid: {} }];
    else fail('music.mjs `sections` is empty: nothing to compose. Write the score (references/music-synthesis.md).');
  }
  let totalDur = opts.durOverride ?? sheet?.duration;
  let cursor = start;
  const secs = list.map((s, i) => {
    let at, dur, pe;
    if (s.picture !== undefined) {
      const pi = typeof s.picture === 'number' ? s.picture : pic.findIndex(x => x.label === s.picture || x.scene === s.picture);
      const ps = pic[pi]; if (!ps) fail(`section ${i} (${s.name}) refers to picture section ${JSON.stringify(s.picture)}, which does not exist (${pic.length} picture sections).`);
      at = ps.at; dur = s.bars != null ? s.bars * barSec : ps.dur; pe = ps.energy;
    } else if (s.at !== undefined) { at = s.at; dur = s.dur ?? (s.bars != null ? s.bars * barSec : s.beats != null ? s.beats * beatSec : null); }
    else { at = cursor; dur = s.dur ?? (s.bars != null ? s.bars * barSec : s.beats != null ? s.beats * beatSec : null); }
    if (dur == null) { if (s.until === 'end' && totalDur) dur = totalDur - at; else fail(`section ${i} (${s.name ?? '?'}) needs bars, beats, dur, picture, or until: 'end'.`); }
    if (!(dur > 0)) fail(`section ${i} (${s.name ?? '?'}) has non-positive length.`);
    cursor = at + dur;
    return { ...s, index: i, name: s.name ?? `s${i}`, at, dur, end: at + dur, bars: dur / barSec, energy: s.energy ?? pe ?? 2 };
  });
  if (!totalDur) totalDur = Math.max(...secs.map(s => s.end));
  const DUR = totalDur;
  const lastEnd = Math.max(...secs.map(s => s.end));
  if (!opts.allowNoMusic || list.length > 1 || list[0].name !== '(cues only)') {
    if (lastEnd < DUR - 0.05 && ending !== 'loop') warn.push(`music sections end at ${lastEnd.toFixed(2)} s but the reel is ${DUR.toFixed(2)} s: the rest is cue sounds and tails only.`);
    if (lastEnd < DUR - 0.05 && ending === 'loop') warn.push(`loop: music sections end at ${lastEnd.toFixed(2)} s, the reel at ${DUR.toFixed(2)} s: the seam will be silent.`);
  }
  if (lastEnd > DUR + 0.05) warn.push(`music sections run to ${lastEnd.toFixed(2)} s, past the reel end (${DUR.toFixed(2)} s); the overflow is cut${ending === 'loop' ? ' (loop: folded into the head)' : ''}.`);
  if (ending === 'loop' && Math.abs(DUR / barSec - Math.round(DUR / barSec)) > 0.01) warn.push(`loop: the reel (${DUR.toFixed(3)} s) is not a whole number of bars (${(DUR / barSec).toFixed(2)}); the seam will land off the grid.`);
  const tailSec = ending === 'loop' ? (audio.loopTail ?? 4) : 0;
  const N = Math.ceil((DUR + tailSec) * SR);
  const secAt = t => { let s = secs[0]; for (const x of secs) if (t >= x.at - 1e-9) s = x; return s; };

  // ------------------------------------------------------------ harmony (key and mode are required only when something is pitched)
  const keyOf = s => s.key ?? spec.key;
  for (const s of secs) {
    const k = keyOf(s);
    s.keyless = k === undefined || k === null || k === '';
    s.keyPc = s.keyless ? null : (pcOf(k) + (s.transpose ?? 0) + 120) % 12;
    const sc = s.scale ?? s.mode ?? spec.scale;
    if (!s.keyless && (sc == null || sc === '')) fail(`music.mjs sets key ${JSON.stringify(k)} but no mode/scale (section "${s.name}"). Choose one: node tools/score.mjs --help lists them.`);
    s.modeName = typeof sc === 'string' && sc !== '' ? sc : null;   // ReelMakeEasy: the harmony check refuses some modes by name
    s.scale = sc == null || sc === '' ? null : resolveScale(sc);
    s.chordBars = s.chordBars ?? spec.chordBars ?? 1;
    const prog = s.prog ?? s.progression ?? spec.progression ?? null;
    if (prog && prog.length) {
      if (s.keyless) for (const tok of prog) if (typeof tok === 'string' && ROMANISH.test(tok.trim())) fail(`progression chord "${tok}" is relative to the key, but music.mjs sets no key (section "${s.name}").`);
      s.chords = prog.map(tok => parseChord(tok, s.keyPc ?? 0, s.scale ?? resolveScale('ionian')));
      if (s.transpose && prog.some(Array.isArray)) s.chords = s.chords.map(c => (c.abs ? { ...c, abs: c.abs.map(m => m + s.transpose), root: (c.root + s.transpose + 12) % 12 } : c));
    } else s.chords = s.keyless ? null : [parseChord(1, s.keyPc, s.scale)];
  }
  const needKey = (s, what) => { if (s.keyless || !s.scale) fail(`${what} needs a key and mode, but music.mjs sets none${s.name ? ` (section "${s.name}")` : ''}. Set key + mode (an external track's key, if the score is external).`); };
  const deg = (d, s, oct) => { needKey(s, 'a scale degree'); return degree(d, s.keyPc, s.scale, oct); };
  const progMode = spec.progressionMode ?? 'section';
  const chordIdxAt = t => {
    const s = secAt(t); if (!s.chords) fail(`a chord was needed at ${t.toFixed(2)} s (a pitched voice, a chord token, or a pitched cue sound such as stab / bell / final), but music.mjs sets no key and mode (nor a progression of absolute chords).`);
    const ref = progMode === 'global' ? start : s.at, b = (t - ref) / barSec / s.chordBars;
    return { s, i: ((Math.floor(b + 1e-6) % s.chords.length) + s.chords.length) % s.chords.length, b };
  };
  const chordAt = t => { const { s, i } = chordIdxAt(t); return s.chords[i]; };
  const nextChordAt = t => { const { s, b } = chordIdxAt(t), ref = progMode === 'global' ? start : s.at; const tn = ref + (Math.floor(b + 1e-6) + 1) * s.chordBars * barSec; return tn < DUR ? chordAt(tn) : chordAt(t); };
  const chordSpans = s => {   // [{t0, t1, chord}] covering the section
    if (!s.chords) return [{ t0: s.at, t1: s.end, chord: { none: true, symbol: '-', ints: [] } }];
    const out = []; let t0 = s.at;
    while (t0 < s.end - 1e-6) { const { b } = chordIdxAt(t0 + 1e-6), ref = progMode === 'global' ? start : s.at; const t1 = Math.min(s.end, ref + (Math.floor(b + 1e-6) + 1) * s.chordBars * barSec); out.push({ t0, t1, chord: chordAt(t0 + 1e-6) }); t0 = t1; }
    return out;
  };

  // ------------------------------------------------------------ voices
  const voices = spec.voices ?? {};
  for (const [name, v] of Object.entries(voices)) {
    if (!v.inst) fail(`voice "${name}" needs type (the instrument): one of ${Object.keys(INST).join(', ')}`);
    if (!INST[v.inst]) fail(`voice "${name}": unknown instrument "${v.inst}". Known: ${Object.keys(INST).join(', ')} (node tools/score.mjs --list)`);
    if (v.harmonics != null && v.harmonics !== false) harmonicsSpec(v.harmonics, name);   // validate early
    if (v.porta && !PORTA_INST.has(v.inst)) warn.push(`voice "${name}": porta does nothing on ${v.inst}; only ${[...PORTA_INST].join(', ')} glide (their from / glide parameters)`);
  }
  const voiceRng = {}; const rngOf = name => (voiceRng[name] ??= rng(seed ^ hash(name)));
  const busOf = (v) => v.bus ?? ({ drum: 'beat', tonal: 'music', texture: 'music', fx: 'sfx', foley: 'sfx' }[INST[v.inst].kind] ?? 'music');
  const pitched = v => { const k = INST[v.inst].kind; return (k === 'tonal' || k === 'texture') && !UNPITCHED_TEXTURE.has(v.inst); };
  const octaveOf = v => v.octave ?? (BASS_INST.has(v.inst) ? 2 : INST[v.inst].kind === 'drum' ? 3 : 4);
  const paramsOf = (obj) => { const p = {}; for (const [k, x] of Object.entries(obj || {})) if (!COMPOSER_KEYS.has(k)) p[k] = x; return p; };
  const evalParams = (p, c) => { const o = {}; for (const [k, x] of Object.entries(p)) o[k] = typeof x === 'function' ? x(c) : x; return o; };

  // audition filters (score.mjs --solo / --mute): music.mjs voice names, 'cues' (every cue-sheet sound) or
  // 'inst:<instrument>' (raw instrument events: step() and section-fx sounds such as riser)
  const groupOf = e => (e.cue ? 'cues' : e.voice);
  for (const n of [...(opts.solo ?? []), ...(opts.mute ?? [])]) {
    const ok = n === 'cues' || voices[n] || (n.startsWith('inst:') && INST[n.slice(5)]);
    if (!ok) fail(`--solo/--mute "${n}": not a voice in music.mjs (${Object.keys(voices).join(', ') || 'none'}), 'cues', or inst:<instrument>`);
  }
  const soloSet = opts.solo?.length ? new Set(opts.solo) : null, muteSet = new Set(opts.mute ?? []);
  const audible = e => !muteSet.has(groupOf(e)) && (!soloSet || soloSet.has(groupOf(e)));

  const events = [];      // {t, voice, inst, bus, vel, dur, note, notes, params, gain, pan, send, dsend, mono}
  const hitsLog = {};
  const motifLog = [];   // ReelMakeEasy: every motif statement's notes [t, vel, voice] (build/music.json motif)
  const pushEv = ev => { if (ev.t < 0 && ev.t > -0.05) ev.t = 0; if (ev.t < -0.5 || ev.t >= DUR + tailSec) return; events.push(ev); if (!ev.voice.startsWith('inst:') && !ev.cue) (hitsLog[ev.voice] ??= []).push([+ev.t.toFixed(4), +(ev.vel ?? 1).toFixed(3)]); if (ev.src === 'motif' && !ev.cue) motifLog.push([+ev.t.toFixed(4), +(ev.vel ?? 1).toFixed(3), ev.voice]); };

  const swingFor = (vname, v, pat, s) => pat.swing ?? (typeof s.swing === 'object' && s.swing ? s.swing[vname] : s.swing) ?? v.swing ?? (typeof spec.swing === 'object' && spec.swing ? (spec.swing[vname] ?? spec.swing.default) : spec.swing) ?? 0.5;
  const humanFor = (vname, v, pat) => pat.human ?? v.human ?? (spec.humanize && typeof spec.humanize === 'object' && !('ms' in spec.humanize) && !('vel' in spec.humanize) ? spec.humanize[vname] ?? spec.humanize.default : spec.humanize) ?? null;
  const prevVoicing = {};

  /** resolve a note token for a pitched voice -> { note } | { notes } | null */
  function resolveNote(vname, v, tok, t, s, extra = {}) {
    const oct = extra.octave ?? octaveOf(v), low = extra.low ?? v.low ?? 12 * (oct + 1);
    const tp = (extra.transpose ?? v.transpose ?? 0);
    if (tok === 'C' || tok === 'chord') { const ch = chordAt(t); if (ch.none) return null; const vc = voiceChord(ch, { center: extra.center ?? v.center ?? (low + 7), prev: prevVoicing[vname], style: extra.voicing ?? v.voicing ?? 'close', size: v.size ?? 0 }); prevVoicing[vname] = vc; return { notes: vc.map(m => m + tp) }; }
    if (typeof tok === 'number') return { note: deg(tok, s, oct) + tp };
    if (Array.isArray(tok)) return { notes: tok.map(x => resolveNote(vname, v, x, t, s, extra)?.note).filter(x => x != null) };
    if (typeof tok === 'string' && PITCH_TOKENS.has(tok)) { const ch = chordAt(t); const m = chordTone(ch, tok, low, tok === 'A' ? nextChordAt(t) : null); return m == null ? null : { note: m + tp }; }
    if (typeof tok === 'string' && /^c-?\d+$/.test(tok)) {   // c<k>: k-th tone of the current chord voicing (k >= its size wraps up an octave)
      const ch = chordAt(t); if (ch.none) return null; const vc = voiceChord(ch, { center: extra.center ?? v.center ?? (low + 7), style: 'close' });
      const k = +tok.slice(1), n = vc.length; return { note: vc[((k % n) + n) % n] + 12 * Math.floor(k / n) + tp };
    }
    if (typeof tok === 'string' && /^[A-G]/.test(tok)) return { note: parseNote(tok) + tp };
    if (typeof tok === 'string' && /^[+-]?\d+(\.\d+)?$/.test(tok)) return { note: deg(+tok, s, oct) + tp };
    fail(`voice "${vname}": note token ${JSON.stringify(tok)} not understood (use scale degrees 0..n, chord tones R 3 5 7 9 O A C, c0 c1 c2 (k-th chord tone), or names like 'Eb4').`);
  }
  // arpeggio over chord tones in the voice's register
  function arpNote(vname, v, mode, k, t, s, pat) {
    const ch = chordAt(t); if (ch.none) return null;
    const oct = pat.octave ?? octaveOf(v), low = pat.low ?? v.low ?? 12 * (oct + 1), span = pat.arpOctaves ?? v.arpOctaves ?? 1;
    const base = voiceChord(ch, { center: low + 6, style: 'close' }), tones = [];
    for (let o = 0; o < span; o++) for (const m of base) tones.push(m + 12 * o);
    const n = tones.length; let idx;
    if (mode === 'down') idx = n - 1 - (k % n);
    else if (mode === 'updown') { const p = Math.max(1, 2 * n - 2), q = k % p; idx = q < n ? q : p - q; }
    else if (mode === 'random') idx = Math.floor(rngOf(vname + ':arp')() * n);
    else idx = k % n;
    return { note: tones[idx] + (v.transpose ?? 0) };
  }

  // ------------------------------------------------------------ grids
  const gridSets = spec.grids ?? {};
  const resolveSet = ref => { if (!ref) return {}; if (typeof ref === 'string') { const g = gridSets[ref]; if (!g) fail(`grid set "${ref}" not found. Known: ${Object.keys(gridSets).join(', ') || '(none)'}`); return g; } return ref; };
  const warnedTrip = new Set();
  // 'hold' | true | { hold: true, ...keys } | { grid: 'hold', ...keys } all mean a held note/chord per chord change
  const normPat = p => {
    if (typeof p === 'string') return p.trim() === 'hold' ? { hold: true } : { grid: p };
    if (p === true) return { hold: true };
    if (p && typeof p === 'object' && typeof p.grid === 'string' && p.grid.trim() === 'hold') { const { grid, ...rest } = p; return { ...rest, hold: true }; }
    return p;
  };

  for (const s of secs) {
    let set = { ...resolveSet(s.grid ?? spec.byEnergy?.[s.energy] ?? spec.grid) };
    if (s.add) Object.assign(set, resolveSet(s.add));
    s.motifs = [];
    if (s.motif) s.motifs.push(s.motif === true ? {} : typeof s.motif === 'string' ? { transform: s.motif } : s.motif);
    if (s.play && !Array.isArray(s.play) && typeof s.play === 'object') {
      for (const [vn, val] of Object.entries(s.play)) {
        if (typeof val === 'string' && /^motif\b/.test(val)) { const tr = val.split(':')[1]; s.motifs.push({ voice: vn, ...(tr ? { transform: tr } : {}) }); continue; }
        set[vn] = val;
      }
    }
    for (const m of s.mute ?? []) delete set[m];
    const only = s.only ?? (Array.isArray(s.play) ? s.play : null);
    if (only) for (const k of Object.keys(set)) if (!only.includes(k)) delete set[k];
    const fills = (Array.isArray(s.fill) ? s.fill : s.fill ? [s.fill] : []).map(f => ({ ...f, set: resolveSet(f.grid) }));
    const nBars = Math.ceil(s.bars - 1e-6);
    for (const [vname, raw] of Object.entries(set)) {
      const v = voices[vname]; if (!v) fail(`section "${s.name}" plays voice "${vname}", which is not defined in instruments {}. Defined: ${Object.keys(voices).join(', ') || '(none)'}`);
      if (raw === null || raw === false) continue;
      const pat = normPat(raw);
      const minE = pat.minEnergy ?? v.minEnergy ?? -Infinity, maxE = pat.maxEnergy ?? v.maxEnergy ?? Infinity;
      if (s.energy < minE || s.energy > maxE) continue;
      const base = { ...paramsOf(v), ...paramsOf(pat) };
      const gain = (pat.gain ?? 1) * (v.gain ?? 1), velScale = pat.vel ?? v.vel ?? 1;
      const common = { voice: vname, inst: v.inst, bus: busOf(v), gain, pan: pat.pan ?? v.pan, send: pat.send ?? v.send, dsend: pat.dsend ?? v.dsend, mono: !!(v.mono || v.choke), choke: v.choke, sec: s.index };
      if (pat.hold) {
        const spans = UNPITCHED_TEXTURE.has(v.inst) || !pitched(v) ? [{ t0: s.at, t1: s.end, chord: null }] : chordSpans(s);
        for (const sp of spans) {
          if (sp.chord?.none && pitched(v)) continue;
          const ctx = { t: sp.t0, energy: s.energy, section: s, bar: (sp.t0 - s.at) / barSec, chord: sp.chord, T };
          let nn = {};
          if (pitched(v)) {
            const toks = pat.notes ?? v.notes;
            if (Array.isArray(toks)) nn = { notes: toks.map(x => resolveNote(vname, v, x, sp.t0 + 1e-6, s, pat)?.note).filter(x => x != null) };
            else nn = resolveNote(vname, v, 'C', sp.t0 + 1e-6, s, pat) ?? {};
          }
          pushEv({ ...common, pan: typeof common.pan === 'function' ? common.pan(ctx) : common.pan, send: typeof common.send === 'function' ? common.send(ctx) : common.send, t: sp.t0, dur: sp.t1 - sp.t0, vel: velScale * (pat.velHold ?? v.velHold ?? 0.85), ...nn, params: evalParams(base, ctx) });
        }
        continue;
      }
      if (pat.grid === undefined) fail(`voice "${vname}" in section "${s.name}": pattern needs grid: '...' or 'hold'.`);
      let cells; try { cells = expandGrid(pat.grid); } catch (e) { fail(`voice "${vname}" in section "${s.name}": ${e.message}`); }
      const vs = pat.steps ?? v.steps ?? meter.stepsPerBar, vstep = barSec / vs, spb = vs / meter.beatsPerBar;
      if (pat.steps == null && v.steps == null && [6, 12, 24, 48].includes(cells.length) && [8, 16, 32].includes(vs) && cells.length % vs !== 0 && !warnedTrip.has(vname)) {   // 48 cells on a 16-cell bar is a 3-bar phrase, not a triplet slip (iteration 3)
        warnedTrip.add(vname); warn.push(`voice "${vname}": its ${cells.length}-cell grid runs as a ${cells.length}-cell polymeter over the ${vs}-cell bar. For triplets give the voice or pattern steps: ${cells.length === 6 ? 12 : cells.length} (cells per bar).`);
      }
      const sw = swingFor(vname, v, pat, s), hum = humanFor(vname, v, pat), hr = rngOf(vname + ':h');
      const offset = ((pat.offset ?? v.offset ?? 0) / 1000), gate = pat.gate ?? v.gate ?? 0.9;
      const phase0 = pat.phase === 'global' ? Math.round((s.at - start) / vstep) : 0, rot = pat.rotate ?? 0;
      const nSteps = Math.ceil(s.dur / vstep - 1e-6);
      const velMap = { ...VEL, ...(v.velMap || {}), ...(pat.velMap || {}) };
      const notesSpec = pat.notes ?? v.notes;
      let cyc = 0, lastBar = -1;
      const fillCells = fills.map(f => (f.set[vname] !== undefined ? { ...f, pat: normPat(f.set[vname]) } : null));
      for (let k = 0; k < nSteps; k++) {
        const bar = Math.floor(k / vs);
        if ((pat.notesReset ?? v.notesReset) === 'bar' && bar !== lastBar) cyc = 0;
        lastBar = bar;
        let cl = cells, idx = (((k + phase0 + rot) % cells.length) + cells.length) % cells.length;
        for (const f of fillCells) {
          if (!f) continue;
          const hit = f.last ? bar === nBars - 1 : f.bars ? f.bars.includes(bar) : ((bar + 1) % (f.every ?? 4) === 0);
          if (hit) { if (f.pat === null || f.pat === false || f.pat.grid === undefined) { cl = null; } else { cl = expandGrid(f.pat.grid); idx = (k % vs) % cl.length; } }
        }
        if (!cl) continue;
        const ch = cl[idx];
        if (RESTS.has(ch) || ch === '_') continue;
        let len = 1; while (len < cl.length && cl[(idx + len) % cl.length] === '_') len++;
        let t = s.at + k * vstep + swingOffset(k + phase0, sw, vstep, spb) + offset;
        let vel = (velMap[ch] ?? 0.8) * velScale;
        if (hum) { t += ((hr() * 2 - 1) * (hum.ms ?? 0)) / 1000; vel *= 1 + (hr() * 2 - 1) * (hum.vel ?? 0); }
        if (!(k * vstep < s.dur - 1e-6)) continue;
        const dur = len * vstep * gate;
        let nn = {};
        if (PITCH_TOKENS.has(ch)) nn = resolveNote(vname, v, ch, t + 1e-6, s, pat) ?? null;
        else if (notesSpec !== undefined && notesSpec !== null) {
          if (typeof notesSpec === 'string' && ['up', 'down', 'updown', 'random'].includes(notesSpec)) nn = arpNote(vname, v, notesSpec, cyc, t + 1e-6, s, pat);
          else { const arr = Array.isArray(notesSpec) ? notesSpec : [notesSpec]; nn = resolveNote(vname, v, arr[cyc % arr.length], t + 1e-6, s, pat); }
          cyc++;
        } else if (pitched(v)) { nn = arpNote(vname, v, 'up', cyc++, t + 1e-6, s, pat); }
        else if (v.note !== undefined) nn = { note: typeof v.note === 'string' ? parseNote(v.note) : v.note };
        if (nn === null) continue;
        const ctx = { t, energy: s.energy, section: s, bar, step: k % vs, absStep: k + phase0, vel, chord: s.chords ? chordAt(t + 1e-6) : null, T };
        pushEv({ ...common, pan: typeof common.pan === 'function' ? common.pan(ctx) : common.pan, send: typeof common.send === 'function' ? common.send(ctx) : common.send, t, vel, dur, ...nn, params: evalParams(base, ctx) });
      }
    }
  }

  // ------------------------------------------------------------ motif
  const motifEvents = (m, t0, until, s, over = {}) => {
    if (!m) fail('a motif was requested but music.mjs has no motif { degrees, rhythm, voice }');
    const vname = over.voice ?? m.voice; const v = voices[vname]; if (!v) fail(`motif voice "${vname}" is not defined in instruments {}`);
    let degs = (over.degrees ?? m.degrees).slice(); const cells = expandGrid(over.rhythm ?? m.rhythm);
    let hits = []; for (let i = 0; i < cells.length; i++) { const ch = cells[i]; if (RESTS.has(ch) || ch === '_') continue; let len = 1; while (i + len < cells.length && cells[i + len] === '_') len++; hits.push({ i, len, ch }); }
    let L = cells.length, mstep = barSec / (over.steps ?? m.steps ?? meter.stepsPerBar);
    const trs = [].concat(over.transform ?? []).flatMap(x => String(x).split('+')).filter(Boolean);
    for (const tr of trs) {
      if (tr === 'retro') { hits = hits.map(h => ({ ...h, i: L - h.i - h.len })).reverse(); degs = degs.slice(0, hits.length).reverse(); }
      else if (tr === 'invert') { const d0 = degs[0]; degs = degs.map(d => 2 * d0 - d); }
      else if (tr === 'aug') { mstep *= 2; }
      else if (tr === 'dim') { mstep /= 2; }
      else if (/^shift:?-?\d+$/.test(tr)) { const n = +tr.replace(/^shift:?/, ''); degs = degs.map(d => d + n); }
      else fail(`motif transform "${tr}" unknown (retro, invert, aug, dim, shift:n; combine with '+')`);
    }
    const oct = over.octave ?? m.octave ?? octaveOf(v), gate = over.gate ?? m.gate ?? 0.9;
    hits.forEach((h, j) => {
      const t = t0 + h.i * mstep; if (t >= until - 1e-6) return;
      const next = hits[j + 1], dur = (m.legato && next ? (next.i - h.i) : h.len) * mstep * gate;
      const vel = (VEL[h.ch] ?? 0.8) * (over.vel ?? m.vel ?? 1);
      pushEv({ voice: vname, src: 'motif', inst: v.inst, bus: over.bus ?? busOf(v), sec: over.cue ? undefined : s.index, cue: !!over.cue, gain: v.gain ?? 1, pan: v.pan, send: v.send, dsend: v.dsend, t, vel, dur, note: deg(degs[j % degs.length], s, oct) + (v.transpose ?? 0), params: evalParams(paramsOf(v), { t, energy: s.energy, section: s, T }) });
    });
    return hits.length ? (hits[hits.length - 1].i + hits[hits.length - 1].len) * mstep : 0;
  };
  for (const s of secs) for (const mo of s.motifs) {
    const every = mo.every ? mo.every * barSec : null; let t0 = s.at + (mo.bar ?? 0) * barSec + (mo.beat ?? 0) * beatSec, n = 0;
    do { motifEvents(spec.motif, t0, s.end, s, mo); t0 += every ?? Infinity; n++; } while (every && t0 < s.end - 1e-6 && n < (mo.times ?? 999));
  }

  // ------------------------------------------------------------ explicit notes
  const timeOf = n => (n.at !== undefined ? n.at : n.bar !== undefined ? start + n.bar * barSec + (n.beat ?? 0) * beatSec : n.beat !== undefined ? start + n.beat * beatSec : fail(`note ${JSON.stringify(n)} needs at (s), bar (+beat) or beat`));
  const playVoice = (vname, o, t, extra = {}) => {
    const v = voices[vname]; if (!v) fail(`play(): voice "${vname}" not in instruments {}. Defined: ${Object.keys(voices).join(', ') || '(none)'}`);
    const s = secAt(t);
    let nn = {};
    if (o.note !== undefined) nn = { note: typeof o.note === 'string' ? parseNote(o.note) : o.note };
    else if (o.notes !== undefined) nn = { notes: o.notes.map(x => (typeof x === 'string' && /^[A-G]/.test(x) ? parseNote(x) : resolveNote(vname, v, x, t, s, o)?.note)) };
    else if (o.deg !== undefined) nn = resolveNote(vname, v, o.deg, t, s, o);
    else if (o.tone !== undefined) nn = resolveNote(vname, v, o.tone, t, s, o);
    else if (o.chord) nn = resolveNote(vname, v, 'C', t, s, o);
    else if (pitched(v)) nn = resolveNote(vname, v, 'R', t, s, o);
    else if (v.note !== undefined) nn = { note: typeof v.note === 'string' ? parseNote(v.note) : v.note };
    if (!nn) return;
    const dur = o.dur ?? (o.beats !== undefined ? o.beats * beatSec : o.steps !== undefined ? o.steps * stepSec : stepSec * (v.gate ?? 0.9));
    pushEv({ voice: vname, inst: v.inst, bus: o.bus ?? busOf(v), gain: (o.gain ?? 1) * (v.gain ?? 1), pan: o.pan ?? v.pan, send: o.send ?? v.send, dsend: o.dsend ?? v.dsend, mono: !!(v.mono || v.choke), choke: v.choke,
      t, vel: o.vel ?? 0.8, dur, ...nn, ...extra, params: { ...evalParams(paramsOf(v), { t, energy: s.energy, section: s, T }), ...paramsOf(o) } });
  };
  // notes[].bar is an offset from `start` and counts from 0 (bar 0 = the first bar), like every bar key in music.mjs;
  // the command line and build/timing.txt count from 1. A note that falls past the end is the usual off-by-one.
  (spec.notes ?? []).forEach((n, i) => {
    const t = timeOf(n);
    if (t >= DUR + tailSec) warn.push(`notes[${i}] (voice ${n.voice}${n.bar !== undefined ? `, bar ${n.bar}` : ''}) starts at ${t.toFixed(2)} s, after the reel's end (${DUR.toFixed(2)} s): dropped. music.mjs bars count from 0 (bar B of build/timing.txt is bar B - 1 here)`);
    playVoice(n.voice, n, t, { src: 'note' });
  });

  // ------------------------------------------------------------ raw instrument events (step(), cues, section fx sounds)
  const rawInst = (name, o, t, defBus = 'music', extra = {}) => {
    if (!INST[name]) fail(`inst(): unknown instrument "${name}". Known: ${Object.keys(INST).join(', ')}`);
    const bus = o.bus ?? (INST[name].kind === 'fx' || INST[name].kind === 'foley' ? 'sfx' : INST[name].kind === 'drum' ? 'beat' : defBus);
    let nn = {};
    if (o.note !== undefined) nn.note = typeof o.note === 'string' ? parseNote(o.note) : o.note;
    if (o.notes !== undefined) nn.notes = o.notes.map(x => (typeof x === 'string' ? parseNote(x) : x));
    if (o.deg !== undefined) nn.note = deg(o.deg, secAt(t), o.octave ?? 4);
    pushEv({ voice: `inst:${name}`, inst: name, bus, t, vel: o.vel ?? 1, dur: o.dur, gain: o.gain ?? 1, pan: o.pan, send: o.send, dsend: o.dsend, ...nn, ...extra, params: paramsOf(o) });
  };

  // ------------------------------------------------------------ step(ctx) escape hatch
  if (typeof spec.step === 'function') {
    const total = Math.ceil((Math.min(DUR, lastEnd) - start) / stepSec - 1e-6), sr = rng(seed ^ hash('step'));
    for (let a = 0; a < total; a++) {
      const t = start + a * stepSec, s = secAt(t), ch = s.chords ? chordAt(t + 1e-6) : null;
      const ctx = { t, absStep: a, step: a % meter.stepsPerBar, bar: Math.floor(a / meter.stepsPerBar), beat: (t - start) / beatSec, section: s, sectionBar: Math.floor((t - s.at) / barSec + 1e-6), energy: s.energy,
        chord: ch ? { ...ch, notes: voiceChord(ch, { center: 60 }) } : null, key: s.keyPc, scale: s.scale, T, stepSec, barSec, stepsPerBar: meter.stepsPerBar, rng: sr, lib,
        play: (vname, o = {}) => playVoice(vname, o, t + (o.at ?? 0)), inst: (name, o = {}) => rawInst(name, o, t + (o.at ?? 0)),
        cuesNear: (dt = stepSec / 2) => (sheet?.cues ?? []).filter(c => Math.abs(c.t - t) <= dt) };
      spec.step(ctx);
    }
  }

  // ------------------------------------------------------------ cue sound design
  const busFx = [];
  const cueMap = spec.cues ?? {};
  const cueScale = spec.cueScale ? resolveScale(spec.cueScale) : null;
  const cueApi = c => ({
    inst: (name, o = {}) => rawInst(name, { bus: 'sfx', ...o }, o.t ?? c.t, 'sfx', { cue: true, cueT: c.t, cueKind: c.kind }),
    play: (vname, o = {}) => playVoice(vname, { bus: 'sfx', ...o }, o.t ?? c.t, { cue: true, cueT: c.t, cueKind: c.kind }),
    chordAt: t => { const ch = chordAt(t + 1e-6); return voiceChord(ch, { center: spec.cueCenter ?? 57 }); },
    cueNote: d => { const s = secAt(c.t); needKey(s, `cue "${c.kind}" at ${c.t.toFixed(2)} s`); return degree(d, s.keyPc, cueScale ?? s.scale, spec.cueOctave ?? 5); },
    duration: DUR, T, rand: rng(seed ^ hash(`cue:${c.kind}:${c.t}`)), sheet, spec,
  });
  const cueKindsSeen = {}, unvoiced = {};
  for (const c of sheet?.cues ?? []) {
    const ov = cueMap[c.kind];
    cueKindsSeen[c.kind] = (cueKindsSeen[c.kind] ?? 0) + 1;
    if (ov === false) continue;
    const kind = c.kind;
    if (PICTURE_ONLY.has(kind) && ov === undefined) continue;
    if (BUS_KINDS.has(kind) && ov === undefined) {
      const d = c.d ?? c.dur;
      if (kind === 'reverse') busFx.push({ kind: c.mode === 'rewind' ? 'rewind' : 'swell', t: c.t, dur: d ?? (c.mode === 'rewind' ? 0.5 : 0.6), speed: c.speed, gain: c.g ?? c.gain, bus: c.bus, cue: true });
      else busFx.push({ ...c, kind, dur: d ?? (kind === 'gap' ? stepSec : kind === 'stutter' ? beatSec : 0.5), len: c.len ?? (kind === 'stutter' ? beatSec / 8 : undefined), cue: true });
      continue;
    }
    if (typeof ov === 'function') { ov(c, cueApi(c)); continue; }
    if (typeof ov === 'string') { playVoice(ov, { bus: 'sfx', deg: c.note ?? undefined, tone: c.note === undefined ? 'R' : undefined, vel: c.g ?? c.s ?? 0.9 }, c.t, { cue: true, cueT: c.t, cueKind: c.kind }); continue; }
    if (ov && typeof ov === 'object') {
      if (ov.voice) playVoice(ov.voice, { bus: 'sfx', vel: c.g ?? 1, ...ov, deg: ov.deg ?? c.note }, c.t, { cue: true, cueT: c.t, cueKind: c.kind });
      else if (ov.inst || ov.type) { const name = ov.inst ?? ov.type; rawInst(name, { bus: 'sfx', ...ov, dur: ov.dur ?? c.d, gain: (ov.gain ?? 1) * (c.g ?? 1) }, c.t, 'sfx', { cue: true, cueT: c.t, cueKind: c.kind }); }
      else fail(`cues.${kind} override needs voice (a music.mjs voice) or type (an instrument)`);
      continue;
    }
    if (kind === 'note') { if (!c.voice) { warn.push(`cue note at ${c.t}s has no voice`); continue; } playVoice(c.voice, { bus: c.bus ?? 'sfx', ...c, gain: c.g ?? c.gain }, c.t, { cue: true, cueT: c.t, cueKind: c.kind }); continue; }
    if (kind === 'motif') { motifEvents(spec.motif, c.t, c.t + 60, secAt(c.t), { bus: 'sfx', ...c, cue: true }); continue; }
    if (kind === 'sfx') { const name = c.inst ?? c.type; if (!name) { warn.push(`cue sfx at ${c.t}s has no inst`); continue; } rawInst(name, { bus: 'sfx', ...c, dur: c.dur ?? c.d, gain: (c.gain ?? 1) * (c.g ?? 1) }, c.t, 'sfx', { cue: true, cueT: c.t, cueKind: c.kind }); continue; }
    if (!defaultCue(c, cueApi(c))) (unvoiced[kind] ??= []).push(c.t);
  }
  // a kind the composer does not know (a scene's own 'seal', 'stand' ...) is SILENT: one warning per kind
  for (const [kind, ts] of Object.entries(unvoiced))
    warn.push(`cue kind "${kind}" (${ts.length}x, first at ${ts[0].toFixed(2)} s) has no default sound and stays silent: voice it with cues.${kind} in music.mjs, or set cues.${kind}: false if it is picture-only`);

  // ------------------------------------------------------------ music.mjs fx: global (absolute) and per section (relative)
  const sectionShort = (f, s) => {                // string shorthands shaped by the section
    const lastBeat = Math.min(beatSec, s.dur), lastBar = Math.min(barSec, s.dur);
    let m;
    if ((m = /^gap(\d+)?$/.exec(f))) { const d = Math.min(s.dur, 4 * beatSec / +(m[1] ?? 16)); return { kind: 'gap', t: s.end - d, dur: d, bus: 'all' }; }
    switch (f) {
      case 'tapestop': return { kind: 'tapestop', t: s.end - lastBeat, dur: lastBeat, resume: s.end };
      case 'stutter': return { kind: 'stutter', t: s.end - lastBeat, dur: lastBeat, len: beatSec / 8 };
      case 'bitcrush': return { kind: 'bitcrush', t: s.at, dur: s.dur };
      case 'filter': case 'lpclose': return { kind: 'filter', type: 'lp', t: s.at, dur: s.dur, f0: 18000, f1: 400 };
      case 'lpopen': return { kind: 'filter', type: 'lp', t: s.at, dur: s.dur, f0: 300, f1: 18000 };
      case 'hpopen': case 'thin': return { kind: 'filter', type: 'hp', t: s.at, dur: s.dur, f0: 30, f1: 1200 };
      case 'reverse': return { kind: 'swell', t: s.end, dur: Math.min(2 * beatSec, s.dur) };
      case 'granular': case 'freeze': return { kind: 'granular', t: s.at + Math.min(beatSec, s.dur / 2), dur: s.dur - Math.min(beatSec, s.dur / 2), src: s.at };
      case 'shepard': return { sound: 'shepard', t: s.at, dur: s.dur };
      case 'riser': return { sound: 'riser', t: s.end - lastBar, dur: lastBar };
      case 'downlifter': return { sound: 'downlifter', t: s.at, dur: lastBar };
      default: fail(`section "${s.name}" fx "${f}" unknown. Strings: gap | gap<N> (silence the last 1/N note) | tapestop | stutter | bitcrush | filter | lpopen | hpopen | reverse | granular | shepard | riser | downlifter; or objects { kind, bar, beat, dur|bars|beats, ... }.`);
    }
  };
  const addFx = f => {
    if (f.sound || (INST[f.kind] && !BUS_FX[f.kind] && f.kind !== 'swell')) { const name = f.sound ?? f.kind; rawInst(name, { bus: 'sfx', ...f, kind: undefined, sound: undefined }, f.t, 'sfx'); return; }
    if (f.kind === 'reverse') { busFx.push({ ...f, kind: f.mode === 'rewind' ? 'rewind' : 'swell' }); return; }
    busFx.push(f);
  };
  for (const f of spec.fx ?? []) {
    if (typeof f === 'string') fail(`music.mjs fx "${f}": global fx need objects { kind, at | bar(+beat), dur, ... }; string shorthands work inside sections.`);
    addFx({ ...f, t: f.t ?? timeOf(f), dur: f.dur ?? (f.bars !== undefined ? f.bars * barSec : f.beats !== undefined ? f.beats * beatSec : undefined) });
  }
  for (const s of secs) for (const f0 of [].concat(s.fx ?? [])) {
    const f = typeof f0 === 'string' ? sectionShort(f0, s) : f0;
    addFx({ ...f, t: f.t ?? s.at + (f.bar ?? 0) * barSec + (f.beat ?? 0) * beatSec, dur: f.dur ?? (f.bars !== undefined ? f.bars * barSec : f.beats !== undefined ? f.beats * beatSec : undefined) });
  }
  // mix.gapBefore = a gap cue before each cue of those kinds: every bus, reverb tails included, unless keep names one.
  // Until iteration 4 it silenced only beat + music, so the sfx bus and its tail filled the gap (clip/new-2: 12 dB under
  // its hit instead of >= 15) while the docs promised the gap cue's behaviour.
  const gb = spec.mix?.gapBefore;
  if (gb) {
    const kinds = gb.kinds ?? ['boom', 'final'], len = gb.sec ?? (gb.steps ?? 1) * stepSec, keep = gb.keep != null ? [].concat(gb.keep) : undefined;
    for (const c of sheet?.cues ?? []) if (kinds.includes(c.kind) && c.t - len > 0) busFx.push({ kind: 'gap', t: c.t - len, dur: len, bus: gb.bus ?? 'all', keep, auto: true });
  }

  // a gap that swallows a note it was not built for: a motif or notes[] note, a cue sound, or any note whose onset falls
  // in the gap while it sounds on past it (heard without its attack). Grid notes that start and end inside the gap are
  // what a gap is for. Iteration 3 (clip/new-2): the motif's second tap sat one 16th before the hit, inside the gap.
  for (const f of busFx) {
    if (f.kind !== 'gap') continue;
    let tg = f.bus === 'all' || !f.bus ? ['beat', 'music', 'sfx'] : f.bus === 'band' ? ['beat', 'music'] : [].concat(f.bus);
    if (f.keep) tg = tg.filter(x => ![].concat(f.keep).includes(x));
    const a = f.t, b = f.t + (f.dur ?? f.d ?? stepSec);
    const hit = events.filter(e => tg.includes(e.bus) && e.t >= a - 1e-6 && e.t < b - 1e-6 && audible(e) && (e.src || e.cue || e.t + (e.dur ?? 0) > b + 0.05));
    if (hit.length) warn.push(`gap ${a.toFixed(3)}-${b.toFixed(3)} s (${f.auto ? 'mix.gapBefore' : f.cue ? 'gap cue' : 'music.mjs fx'}) swallows the onset of ${hit.length} note${hit.length > 1 ? 's' : ''}: ${hit.slice(0, 4).map(e => `${e.src ? e.src + ' ' : e.cue ? 'cue ' : ''}${e.voice} @ ${e.t.toFixed(3)} s`).join(', ')}${hit.length > 4 ? ' ...' : ''}. Move ${hit.length > 1 ? 'them' : 'it'} out of the gap (a gap before a hit ends on the hit), shorten the gap, or keep: ['<bus>'] on it`);
  }

  // ------------------------------------------------------------ choke / mono voices
  const groups = {};
  for (const e of events) if (e.mono) (groups[e.choke && typeof e.choke === 'string' ? e.choke : e.voice] ??= []).push(e);
  for (const g of Object.values(groups)) { g.sort((a, b) => a.t - b.t); for (let i = 0; i < g.length - 1; i++) if (g[i + 1].t > g[i].t) g[i].cut = g[i + 1].t; }

  // ------------------------------------------------------------ portamento: each note of a `porta` voice starts from the previous one
  for (const [vn, v] of Object.entries(voices)) {
    if (!v.porta || !PORTA_INST.has(v.inst)) continue;
    let prev = null;
    for (const e of events.filter(x => x.voice === vn && x.note !== undefined).sort((a, b) => a.t - b.t)) {
      const touching = prev && prev.t + (prev.dur ?? 0) >= e.t - 0.002;          // 'legato': only out of a note still held
      if (prev && (v.porta !== 'legato' || touching) && e.params?.from === undefined && e.params?.slide === undefined && prev.note !== e.note) e.params = { ...e.params, from: prev.note };
      prev = e;
    }
  }

  // ------------------------------------------------------------ ReelMakeEasy: the harmony check (harmony.mjs) on every pitched note
  const harmony = checkHarmony({
    beatsPerBar: meter.beatsPerBar, stepsPerBar: meter.stepsPerBar, beatSec, start, duration: DUR,
    sections: secs.map(s => ({ name: s.name, at: s.at, end: s.end, keyPc: s.keyPc, mode: s.modeName ?? s.scale, scale: s.scale })),
    chords: secs.flatMap(s => (s.chords ? chordSpans(s).map(sp => ({ ...sp, section: s.name })) : [])),
    notes: events.filter(e => isPitchedEvent(e, INST[e.inst]?.kind)).flatMap(e => {
      const many = eventPitches(e), hz = e.inst === 'shing' || e.params?.f != null;
      const role = HARMONY_BASS.has(e.inst) ? 'bass' : many.length > 1 || CHORD_INST.has(e.inst) ? 'chord' : 'melody';
      let hold = soundingSec(e.inst, e.params, e.dur);
      if (e.cut != null) hold = Math.min(hold, e.cut - e.t);
      const inharmonic = inharmonicWhy(e.inst, e.params);
      return many.map(m => ({ voice: e.cue ? `${e.voice} (cue ${e.cueKind ?? ''})`.replace(' )', ')') : e.voice, inst: e.inst, t: e.t, dur: e.dur ?? hold, hold, midi: m, vel: e.vel, role, inharmonic, cue: !!e.cue, ...(hz ? { hz: true } : {}) }));
    }),
  });

  // ------------------------------------------------------------ render (voices with inserts or harmonics render privately first)
  events.sort((a, b) => a.t - b.t || (a.voice < b.voice ? -1 : a.voice > b.voice ? 1 : 0));
  const buses = { beat: new Bus(N, 'beat'), music: new Bus(N, 'music'), sfx: new Bus(N, 'sfx') };
  const privates = {};
  for (const [vn, v] of Object.entries(voices)) if ((v.fx && [].concat(v.fx).length) || (v.harmonics != null && v.harmonics !== false)) privates[vn] = { bus: new Bus(N, `voice:${vn}`), v };
  const probe = opts.probe ? {} : null;
  const probeOf = g => (probe[g] ??= new Float32Array(N));
  const tee = (bus, arr) => ({ n: bus.n, add(i, l, r, s, d) { bus.add(i, l, r, s, d); if (i >= 0 && i < arr.length && l === l && r === r) arr[i] += 0.5 * (l + r); } });
  for (const e of events) {
    if (opts.onlyBus && e.bus !== opts.onlyBus) continue;
    if (!audible(e)) continue;
    const priv = privates[e.voice];
    const bus = priv ? priv.bus : buses[e.bus] ?? fail(`unknown bus "${e.bus}" (beat | music | sfx)`);
    if (!priv) bus.used = true;
    const o = { bus: probe && !priv ? tee(bus, probeOf(groupOf(e))) : bus, rand: rngOf(e.voice), bpm };
    const p = { ...e.params, vel: e.vel, dur: e.dur, gain: e.gain ?? 1 };
    if (e.note !== undefined) p.note = e.note; if (e.notes !== undefined) p.notes = e.notes;
    if (e.pan !== undefined) p.pan = e.pan; if (e.send !== undefined) p.send = e.send; if (e.dsend !== undefined) p.dsend = e.dsend; if (e.cut !== undefined) p.cut = e.cut;
    if (priv) { p.send = 0; p.dsend = 0; priv.bus.target = e.bus; }
    try { INST[e.inst].play(o, e.t, p); }
    catch (err) { fail(`${e.cue ? 'a cue sound' : `voice "${e.voice}"`} (${e.inst}) at ${e.t.toFixed(2)} s: ${err.message}`); }
  }
  for (const [vn, pr] of Object.entries(privates)) {
    if (!pr.bus.used) continue;
    if (pr.v.fx && [].concat(pr.v.fx).length) applyInserts(pr.bus.L, pr.bus.R, pr.v.fx, { bpm });
    let hx = null;
    if (pr.v.harmonics != null && pr.v.harmonics !== false) hx = addHarmonics(pr.bus.L, pr.bus.R, harmonicsSpec(pr.v.harmonics, vn));
    const tgt = buses[pr.bus.target ?? busOf(pr.v)], snd = pr.v.send ?? INST[pr.v.inst].send ?? 0, dsnd = pr.v.dsend ?? 0;
    for (let i = 0; i < N; i++) tgt.add(i, pr.bus.L[i], pr.bus.R[i], snd, dsnd);
    if (probe) { const a = probeOf(vn); for (let i = 0; i < N; i++) a[i] += 0.5 * (pr.bus.L[i] + pr.bus.R[i]); }
    if (pr.v.fx && [].concat(pr.v.fx).length) log.push(`voice ${vn}: inserts ${[].concat(pr.v.fx).map(f => f.type ?? f.kind).join(' > ')}`);
    if (hx) log.push(`voice ${vn}: harmonics 2-12 at ${hx.db} dB under the voice (fundamental below ${hx.input} Hz, kept ${hx.hp}-${hx.lp} Hz)${hx.silent ? ': nothing to excite' : ''}`);
  }

  // ------------------------------------------------------------ duck envelope
  const mix = spec.mix ?? {};
  let duckEnv = null;
  if (mix.duck) {
    const d = mix.duck, by = d.by ?? ['kick'], depth = d.depth ?? 0.4, len = d.sec ?? (d.beats ?? 0.6) * beatSec, ln = Math.round(len * SR);
    duckEnv = new Float32Array(N).fill(1);
    const times = [...events.filter(e => by.includes(e.voice)).map(e => e.t), ...(sheet?.cues ?? []).filter(c => by.includes(c.kind)).map(c => c.t)];
    if (!times.length) warn.push(`mix.duck.by ${JSON.stringify(by)} matched no voice or cue kind: nothing ducks`);
    for (const t0 of times) { const s0 = S(t0); for (let i = 0; i < ln; i++) { const j = s0 + i; if (j < 0 || j >= N) continue; const g = 1 - depth * Math.pow(1 - i / ln, 2); if (g < duckEnv[j]) duckEnv[j] = g; } }
  }
  const duckTargets = new Set(mix.duck?.targets ?? ['music']);

  // ------------------------------------------------------------ delay + reverb per bus, duck, bus fx
  const rv = { size: 0.83, damp: 0.32, wet: 0.85, ...(mix.reverb || {}) };
  const dl = { beats: 0.75, fb: 0.35, lp: 3500, wet: 1, ...(mix.delay || {}) };
  for (const [name, b] of Object.entries(buses)) {
    if (!b.used) continue;
    let hasD = false; for (let i = 0; i < N; i++) if (b.dL[i] || b.dR[i]) { hasD = true; break; }
    if (hasD) { const dlL = delayLine({ time: dl.beats * beatSec, fb: dl.fb, lp: dl.lp }), dlR = delayLine({ time: dl.beats * beatSec * (dl.spread ?? 1.0), fb: dl.fb, lp: dl.lp });
      for (let i = 0; i < N; i++) { const yl = dlL(b.dL[i]) * dl.wet, yr = dlR(b.dR[i]) * dl.wet; b.L[i] += yl; b.R[i] += yr; b.sL[i] += yl * 0.3; b.sR[i] += yr * 0.3; } }
    const rl = reverb({ size: rv.size, damp: rv.damp, side: 0 }), rr = reverb({ size: rv.size, damp: rv.damp, side: 1 }), dk = duckEnv && duckTargets.has(name);
    const wet = (mix.reverbBus?.[name] ?? 1) * rv.wet;
    for (let i = 0; i < N; i++) { const g = dk ? duckEnv[i] : 1; b.L[i] = b.L[i] * g + rl(b.sL[i]) * wet; b.R[i] = b.R[i] * g + rr(b.sR[i]) * wet; }
    b.sL = b.sR = b.dL = b.dR = null;
  }
  busFx.sort((a, b) => a.t - b.t);
  const fxLog = [];
  for (const f of busFx) {
    if (f.kind === 'swell') continue;      // applied on the master sum below
    const fn = BUS_FX[f.kind]; if (!fn) { warn.push(`bus fx "${f.kind}" unknown (${Object.keys(BUS_FX).join(', ')}, reverse)`); continue; }
    let targets = f.bus === 'all' || (f.kind === 'gap' && !f.bus) ? ['beat', 'music', 'sfx'] : !f.bus || f.bus === 'band' ? ['beat', 'music'] : [].concat(f.bus);
    if (f.keep) targets = targets.filter(x => ![].concat(f.keep).includes(x));
    const prm = { ...f, dur: f.dur ?? f.d ?? 0.5, seed: seed ^ hash(`fx:${f.kind}:${f.t}`) };
    for (const bn of targets) { const b = buses[bn]; if (!b) fail(`bus fx "${f.kind}" at ${f.t}s: unknown bus "${bn}" (beat | music | sfx | band | all)`); if (b.used) fn(b.L, b.R, prm); }
    fxLog.push({ kind: f.kind, t: +f.t.toFixed(3), dur: +(prm.dur).toFixed(3), bus: targets.join('+'), from: f.cue ? 'cue' : f.auto ? 'mix.gapBefore' : 'music.mjs' });
  }

  // ------------------------------------------------------------ master sum
  let L = new Float32Array(N), R = new Float32Array(N);
  for (const b of Object.values(buses)) if (b.used) for (let i = 0; i < N; i++) { L[i] += b.L[i]; R[i] += b.R[i]; }
  for (const f of busFx) if (f.kind === 'swell') { const srcL = L.slice(), srcR = R.slice(); swell(L, R, { t: f.t, dur: f.dur ?? 0.6, gain: f.gain ?? 0.6 }, srcL, srcR); fxLog.push({ kind: 'reverse(swell)', t: +f.t.toFixed(3), dur: f.dur ?? 0.6, bus: 'master', from: f.cue ? 'cue' : 'music.mjs' }); }

  const DN = Math.round(DUR * SR);
  if (ending === 'loop') {         // fold the tail (reverb, held notes) into the head
    for (let i = DN; i < N; i++) { const j = (i - DN) % DN; L[j] += L[i]; R[j] += R[i]; }
    L = L.slice(0, DN); R = R.slice(0, DN);
  }
  masterChain(L, R, mix, ending === 'loop');
  if (ending !== 'loop') { L = L.slice(0, DN); R = R.slice(0, DN); }

  // ------------------------------------------------------------ endings
  const endInfo = { mode: ending };
  const fadeIn = Math.round(0.005 * SR);
  if (ending !== 'loop') for (let i = 0; i < Math.min(fadeIn, DN); i++) { const g = i / fadeIn; L[i] *= g; R[i] *= g; }
  if (ending === 'ring') {
    const rf = audio.ringFade ?? spec.ringFade ?? 0.5, fn = Math.max(1, Math.round(rf * SR));
    for (let i = Math.max(0, DN - fn); i < DN; i++) { const g = 0.5 + 0.5 * Math.cos(Math.PI * (i - (DN - fn)) / fn); L[i] *= g; R[i] *= g; }
    endInfo.fade = rf;
  } else if (ending === 'button') {
    const cues = sheet?.cues ?? [];
    const finalCue = [...cues].reverse().find(c => c.kind === 'final') ?? [...cues].reverse().find(c => (c.s ?? 0) >= 0.6);
    const at = audio.buttonAt ?? spec.buttonAt ?? finalCue?.t ?? lastEnd;
    const gate = audio.buttonGate ?? spec.buttonGate ?? 0.012, relN = Math.round(0.008 * SR);
    const g0 = S(at + gate);
    for (let i = Math.max(0, g0); i < DN; i++) { const k = i - g0; const g = k < relN ? 0.5 + 0.5 * Math.cos(Math.PI * k / relN) : 0; L[i] *= g; R[i] *= g; }
    // what the gate silences: notes and cue sounds that start after it (a sonic logo after the final hit was cut to its
    // first note in iteration 3, lock/new-2); the grid running on past the button is counted, not listed
    const after = events.filter(e => e.t >= at + gate - 1e-6 && e.t < DUR && audible(e) && !(e.cueT != null && Math.abs(e.cueT - at) < 1e-3));   // not the final hit's own sound
    const named = after.filter(e => e.src || e.cue || e.voice.startsWith('inst:'));
    endInfo.cut = named.slice(0, 12).map(e => ({ voice: e.voice, t: +e.t.toFixed(3), ...(e.src ? { src: e.src } : e.cue ? { src: 'cue' } : {}) }));
    endInfo.cutCount = named.length; endInfo.cutGrid = after.length - named.length;
    Object.assign(endInfo, { finalAt: +at.toFixed(4), gate: +gate.toFixed(4), silentFrom: +((g0 + relN) / SR).toFixed(4), source: audio.buttonAt != null ? 'audio.buttonAt' : spec.buttonAt != null ? 'music.buttonAt' : finalCue ? `cue ${finalCue.kind} @ ${finalCue.t.toFixed(3)}` : 'end of music sections' });
    if (!finalCue && audio.buttonAt == null && spec.buttonAt == null) (sheet ? warn : log).push('button ending: no final cue (kind final or s >= 0.6) and no buttonAt; the button falls on the end of the music sections.');
  } else endInfo.tail = tailSec;

  // ------------------------------------------------------------ control signals for the picture (build/music.json)
  const signals = makeSignals({ L, R, buses, DN, secs, events, busFx, duckEnv, rate: opts.signalRate ?? 120, loop: ending === 'loop' });

  // ------------------------------------------------------------ report
  const chordsLog = [];
  for (const s of secs) if (s.chords) for (const sp of chordSpans(s)) chordsLog.push({ t: +sp.t0.toFixed(3), section: s.name, symbol: sp.chord.symbol, notes: voiceChord(sp.chord, { center: 60 }).map(nameOf) });
  const s0 = secs[0];
  const info = {
    bpm, meter: meter.label, beatsPerBar: meter.beatsPerBar, stepsPerBar: meter.stepsPerBar, beatSec, barSec, stepSec, duration: DUR, ending: endInfo, seed,
    key: s0.keyless ? null : typeof (s0.key ?? spec.key) === 'string' && !s0.transpose ? String(s0.key ?? spec.key).trim() : nameOf(s0.keyPc + 60).replace(/-?\d+$/, ''), scale: spec.scale ?? null,
    sections: secs.map(s => ({ name: s.name, at: +s.at.toFixed(3), dur: +s.dur.toFixed(3), bars: +s.bars.toFixed(2), energy: s.energy, grid: typeof s.grid === 'string' ? s.grid : (spec.byEnergy?.[s.energy] ?? (typeof spec.grid === 'string' ? spec.grid : s.grid || s.play ? 'inline' : '-')),
      voices: [...new Set(events.filter(e => (e.sec !== undefined ? e.sec === s.index : e.t >= s.at && e.t < s.end) && !e.voice.startsWith('inst:') && !e.cue).map(e => e.voice))] })),
    chords: chordsLog, hits: hitsLog, motif: motifLog, harmony, events: events.length, cueKinds: cueKindsSeen, fx: fxLog, warnings: warn, log,
    voices: Object.fromEntries(Object.entries(voices).map(([k, v]) => [k, { inst: v.inst, bus: busOf(v), fx: v.fx ? [].concat(v.fx).map(f => f.type ?? f.kind) : undefined,
      harmonics: v.harmonics != null && v.harmonics !== false ? harmonicsSpec(v.harmonics, k).db : undefined, gain: typeof v.gain === 'number' ? v.gain : undefined }])),
  };
  if (probe && ending === 'loop') for (const [g, a] of Object.entries(probe)) {   // fold like the mix
    for (let i = DN; i < a.length; i++) a[(i - DN) % DN] += a[i];
    probe[g] = a.slice(0, DN);
  } else if (probe) for (const [g, a] of Object.entries(probe)) probe[g] = a.slice(0, DN);
  if (opts.exportEvents) info.eventList = events.map(e => ({ t: e.t, voice: e.voice, inst: e.inst, vel: e.vel, dur: e.dur, note: e.note, notes: e.notes, cue: e.cue, cueT: e.cueT, kind: e.kind })); // tools/sonicpi/export.mjs reads every note
  return { L, R, info, signals, probe };
}

// ------------------------------------------------------------------ harmonics: a parallel exciter for small speakers
// Phone and laptop speakers roll off below ~150-200 Hz, so a sub, kick or 808 line vanishes on them while the
// loudness normaliser still pays for it; the ear rebuilds a missing fundamental from its harmonic series, which is
// what psychoacoustic bass processors exploit. A tanh drive makes those harmonics, but square-ish ones whose peaks
// all line up with the bass's own peak: on an 808, a parallel tanh path 6 dB under the voice raised the peak by
// 4.5-5.9 dB (this design: 3.5 dB), and drive on the kick-like voice left the phone QC open on 5 test scores
// (music-synthesis.md §10). So the harmonics are synthesised instead. A zero-phase low-pass at `input` isolates the fundamental (zero phase
// keeps it aligned with the dry voice), a centred 30 ms RMS envelope normalises it to a unit cosine c, and the
// Chebyshev polynomials T_k(c) = cos(k theta) give harmonics 2..12 exactly, at k^-0.5, with the signs below. Those
// signs were searched so that the dry fundamental plus the harmonics peaks at most +1.8 dB (mean +0.7 dB) above the
// fundamental alone, over bass notes of 35-130 Hz and harmonic levels of -4 to -10 dB (aligned signs: +9.7 dB).
// Then a zero-phase high-pass at `hp` (the phone QC's slope, so the fundamental is never doubled) and low-pass at
// `lp`, scaled to `db` below the voice's RMS and added in mono. The sub itself is untouched. Monophonic low voices
// only: a chord or two bass notes at once intermodulate into non-harmonic grit.
const HARM_DEFAULTS = { db: -8, input: 120, hp: 200, lp: 3500 };
const HARM_SIGNS = [1, -1, -1, -1, 1, 1, -1, -1, 1, 1, -1];               // k = 2..12
export function harmonicsSpec(h, name = '?') {
  if (h === true) return { ...HARM_DEFAULTS };
  if (typeof h === 'number') return { ...HARM_DEFAULTS, db: h };
  if (h && typeof h === 'object') {
    const bad = Object.keys(h).filter(k => !(k in HARM_DEFAULTS));
    if (bad.length) fail(`voice "${name}": harmonics key(s) ${bad.join(', ')} unknown (${Object.keys(HARM_DEFAULTS).join(', ')})`);
    const o = { ...HARM_DEFAULTS, ...h };
    for (const [k, v] of Object.entries(o)) if (typeof v !== 'number' || !Number.isFinite(v)) fail(`voice "${name}": harmonics.${k} must be a number`);
    return o;
  }
  fail(`voice "${name}": harmonics takes true, a level in dB (e.g. -8), or { db, input, hp, lp }`);
}
/** zero-phase biquad (forward, then backward): the magnitude squared, no phase shift */
function zeroPhase(x, type, f) {
  const a = biquad(type, f, 0.707), b = biquad(type, f, 0.707), n = x.length, y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = a(x[i]);
  for (let i = n - 1; i >= 0; i--) y[i] = b(y[i]);
  return y;
}
function addHarmonics(L, R, h) {
  const n = L.length, mid = new Float32Array(n);
  let eDry = 0; for (let i = 0; i < n; i++) { mid[i] = 0.5 * (L[i] + R[i]); eDry += mid[i] * mid[i]; }
  const lo = zeroPhase(mid, 'lp', h.input), pre = new Float64Array(n + 1);
  let pk = 0; for (let i = 0; i < n; i++) { pre[i + 1] = pre[i] + lo[i] * lo[i]; pk = Math.max(pk, Math.abs(lo[i])); }
  if (!(pk > 0)) return { ...h, silent: true };
  const w = Math.round(0.015 * SR), K = HARM_SIGNS.length + 1, amp = [], t0k = [], y = new Float32Array(n);
  for (let k = 2; k <= K; k++) { amp.push(HARM_SIGNS[k - 2] * Math.pow(k, -0.5)); t0k.push(k % 2 ? 0 : (k / 2) % 2 ? -1 : 1); }   // T_k(0): no output where the bass is silent
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - w), b = Math.min(n, i + w + 1), env = Math.sqrt(2 * (pre[b] - pre[a]) / (b - a));
    if (env < pk * 1e-3) continue;
    const c = Math.max(-1, Math.min(1, lo[i] / env)); let tp = 1, tc = c, v = 0;
    for (let k = 2; k <= K; k++) { const tn = 2 * c * tc - tp; tp = tc; tc = tn; v += amp[k - 2] * (tn - t0k[k - 2]); }
    y[i] = v * env;
  }
  const wet = zeroPhase(zeroPhase(y, 'hp', h.hp), 'lp', h.lp);
  let eWet = 0; for (let i = 0; i < n; i++) eWet += wet[i] * wet[i];
  if (!(eWet > 0)) return { ...h, silent: true };
  const k = Math.pow(10, h.db / 20) * Math.sqrt(eDry / eWet);
  for (let i = 0; i < n; i++) { const v = wet[i] * k; L[i] += v; R[i] += v; }
  return h;
}

/** RMS envelopes and musical curves sampled at `rate` Hz, each value rounded to 3 decimals. */
function makeSignals({ L, R, buses, DN, secs, events, busFx, duckEnv, rate, loop }) {
  const hop = SR / rate, frames = Math.ceil(DN / hop), r3 = x => Math.round(x * 1000) / 1000;
  const env = (fnSample) => {        // RMS over a 2-hop window centred on each frame, normalised to its max
    const out = new Float32Array(frames); let mx = 0;
    for (let f = 0; f < frames; f++) {
      const c = Math.round(f * hop), a = Math.max(0, c - hop), b = Math.min(DN, c + hop); let acc = 0;
      for (let i = a; i < b; i++) { const v = fnSample(i); acc += v * v; }
      out[f] = Math.sqrt(acc / Math.max(1, b - a)); if (out[f] > mx) mx = out[f];
    }
    return { data: Array.from(out, v => r3(mx > 0 ? v / mx : 0)), peakDb: mx > 0 ? +(20 * Math.log10(mx)).toFixed(1) : null };
  };
  const mono = new Float32Array(DN); for (let i = 0; i < DN; i++) mono[i] = 0.5 * (L[i] + R[i]);
  const lo = new Float32Array(DN), hi = new Float32Array(DN);
  { const l1 = lp1(150), l2 = lp1(150), h1 = hp1(4000), h2 = hp1(4000); for (let i = 0; i < DN; i++) { lo[i] = l2(l1(mono[i])); hi[i] = h2(h1(mono[i])); } }
  const out = { rate, frames, about: 'value at frame f = signal at f / rate seconds; RMS curves are normalised to 0..1 (peakDb = their 1.0)', curves: {} };
  out.curves.level = env(i => mono[i]);
  for (const [k, b] of Object.entries(buses)) if (b.used) out.curves[k] = env(i => 0.5 * (b.L[i] + b.R[i]));
  out.curves.low = env(i => lo[i]);
  out.curves.high = env(i => hi[i]);
  const energy = new Array(frames).fill(0), riser = new Array(frames).fill(0), fall = new Array(frames).fill(0), filt = new Array(frames).fill(1), duck = duckEnv ? new Array(frames) : null;
  for (let f = 0; f < frames; f++) {
    const t = f / rate; let s = secs[0]; for (const x of secs) if (t >= x.at - 1e-9) s = x; energy[f] = s.energy;
    if (duck) duck[f] = r3(duckEnv[Math.min(duckEnv.length - 1, Math.round(t * SR))]);
  }
  for (const e of events) {
    const up = e.inst === 'riser' || (e.inst === 'shepard' && (e.params?.dir ?? 1) > 0) || (e.inst === 'sweep' && (e.params?.f1 ?? 1200) > (e.params?.f0 ?? 200));
    const down = e.inst === 'downlifter' || (e.inst === 'shepard' && (e.params?.dir ?? 1) < 0) || (e.inst === 'sweep' && (e.params?.f1 ?? 1200) < (e.params?.f0 ?? 200));
    if (!up && !down) continue;
    const d = e.dur ?? e.params?.dur ?? (e.inst === 'shepard' ? 2 : 0.6), arr = up ? riser : fall;
    for (let f = Math.max(0, Math.floor(e.t * rate)); f < Math.min(frames, Math.ceil((e.t + d) * rate)); f++) arr[f] = Math.max(arr[f], r3(clamp((f / rate - e.t) / d)));
  }
  for (const fx of busFx) {
    if (fx.kind !== 'filter') continue;
    const type = fx.type ?? 'lp', f0 = fx.f0 ?? (type === 'hp' ? 30 : 18000), f1 = fx.f1 ?? (type === 'hp' ? 1200 : 400), d = fx.dur ?? 1, hold = fx.hold ?? 0;
    const norm = hz => clamp(Math.log(hz / 20) / Math.log(1000));        // 20 Hz .. 20 kHz -> 0..1
    for (let f = Math.max(0, Math.floor(fx.t * rate)); f < Math.min(frames, Math.ceil((fx.t + d + hold) * rate)); f++) {
      const k = clamp((f / rate - fx.t) / d), fc = f0 * Math.pow(f1 / f0, k), open = type === 'hp' ? 1 - norm(fc) : type === 'lp' ? norm(fc) : 1 - Math.abs(norm(fc) - 0.5) * 2;
      filt[f] = Math.min(filt[f], r3(open));
    }
  }
  out.curves.energy = { data: energy, about: 'section energy (music.mjs), not normalised' };
  out.curves.riser = { data: riser, about: 'progress 0..1 through each riser / rising shepard / rising sweep' };
  out.curves.fall = { data: fall, about: 'progress 0..1 through each downlifter / falling shepard / falling sweep' };
  out.curves.filter = { data: filt, about: 'openness of bus filter sweeps (1 = open)' };
  if (duck) out.curves.duck = { data: duck, about: 'sidechain gain on the ducked buses (1 = no duck)' };
  if (loop) out.loop = true;
  return out;
}

/** master chain: high-pass, mono lows, width, optional drive and tape wow/flutter. twoCycle = loop (warm IIR state). */
export function masterChain(L, R, mix = {}, twoCycle = false) {
  const n = L.length, hpF = mix.hp ?? 25, mono = mix.monoBelow ?? 120, width = mix.width ?? 1, dr = mix.drive ?? 0, tape = mix.tape;
  const hpL = biquad('hp', hpF, 0.707), hpR = biquad('hp', hpF, 0.707), sideHp = biquad('hp', mono, 0.707), sideHp2 = biquad('hp', mono, 0.707);
  let wowL = null, wowR = null;
  if (tape && (tape.wow || tape.flutter)) { wowL = new Float32Array(n); wowR = new Float32Array(n); }
  const passes = twoCycle ? 2 : 1;
  for (let pass = 0; pass < passes; pass++) {
    const write = pass === passes - 1;
    for (let i = 0; i < n; i++) {
      let l = hpL(L[i]), r = hpR(R[i]);
      const m = (l + r) * 0.5; let s = (l - r) * 0.5; s = sideHp2(sideHp(s)) * width;
      l = m + s; r = m - s;
      if (dr > 0) { l = soft(l, dr); r = soft(r, dr); }
      if (write) { if (wowL) { wowL[i] = l; wowR[i] = r; } else { L[i] = l; R[i] = r; } }
    }
  }
  if (wowL) {   // tape wow (0.5 Hz) and flutter (7.3 Hz) as a modulated read; amounts in percent of speed
    const w = (tape.wow ?? 0) / 100, f = (tape.flutter ?? 0) / 100, base = 0.01 * SR;
    for (let i = 0; i < n; i++) { const tt = i / SR, d = base * (1 + (w * 40) * Math.sin(2 * Math.PI * 0.5 * tt) + (f * 40) * Math.sin(2 * Math.PI * 7.3 * tt)); let x = i - d; if (twoCycle) x = ((x % n) + n) % n; L[i] = readAt(wowL, x); R[i] = readAt(wowR, x); }
  }
}
