// The kick check: no elastic ("rubber band") kick. Pure functions over the composed events, no audio.
// ReelMakeEasy added this after the owner rejected the same kick twice: a sine sliding slowly from ~150 Hz to ~45 Hz
// (pitchTau 0.03 s), a 0.3 s tail, and a harmonics layer that slides with it. That slow, audible pitch slide is the
// rubber band. The owner approved one kick only, APPROVED_KICK below (the instrument's defaults are that kick), and
// score.mjs FAILs (exit 3) when the score holds anything else that thumps and slides, whatever instrument plays it:
//   kick       a kick-like voice (instrument kick, a voice named kick / bd..., or a voice that mix.duck.by ducks the
//              mix on, which is the kick's job) with a pitch move slower than MAX_PITCH_TAU, a tail longer than
//              MAX_DECAY, or a harmonics layer
//   thump      any other drum, fx or foley hit whose pitch slides (either way) by THUMP_SEMIS or more, slower than
//              MAX_PITCH_TAU, down into the kick register (<= THUMP_HZ), with a tail longer than MAX_DECAY, when one
//              voice plays it THUMP_REPEATS times or more: the rubber band under another name (a tom, a conga, a
//              boom, a logdrum, a sweep or a bloop on the beat). One or two impacts (a boom at the drop) pass.
//   slide      an e808 hit with a downward from / slide glide slower than MAX_PITCH_TAU (the 808 rubber band), and
//              any e808 glide played as an impact (a cue sound or a raw instrument hit)
//   harmonics  a harmonics layer on any voice whose pitch moves (by a semitone or more, at any speed): the layer
//              slides with the pitch, the elastic sound again
// Cue sounds count like any other hit. pitchOf() models every instrument whose own parameters move the pitch.

/** The one kick the owner approved (music-synthesis.md recipe D): fast pitch drop, short tail, beater click, a little
 *  drive, no harmonics layer. `gain` is the voice's level (~0.7). */
export const APPROVED_KICK = { inst: 'kick', f0: 200, f1: 55, pitchTau: 0.008, decay: 0.1, click: 0.65, drive: 1.3, gain: 0.7 };
/** The kick instrument's defaults: the approved kick's sound (instruments.mjs reads these). */
export const KICK_DEFAULTS = { f0: 200, f1: 55, pitchTau: 0.008, decay: 0.1, click: 0.65, drive: 1.3 };
/** A pitch move slower than this (s) is audible as a slide (the approved kick drops in 0.008 s). */
export const MAX_PITCH_TAU = 0.012;
/** A kick's tail longer than this (s) rings like a tom. */
export const MAX_DECAY = 0.15;
/** The kick register: a slide that reaches this low (Hz) is a thump (kick fundamentals sit at ~40-120 Hz; the approved
 *  kick ends at 55 Hz, the rejected one at 45). */
export const THUMP_HZ = 120;
/** A slide smaller than this (semitones) is the drum's own skin tension, not a slide (a taiko bends 3.9). */
export const THUMP_SEMIS = 4;
/** One voice playing a sliding thump this many times or more plays it as a beat. */
export const THUMP_REPEATS = 3;
/** The logdrum's drop time default (s): as fast as the approved kick's drop, so a logdrum bass line is no rubber band. */
export const LOGDRUM_DROP_TIME = 0.012;
/** A voice named as a kick, whatever plays it (ReelMakeEasy reads these as the reel's kicks too). */
export const KICK_NAME = /kick|^bd/i;
const APPROVED_TEXT = "{ inst: 'kick', f0: 200, f1: 55, pitchTau: 0.008, decay: 0.1, click: 0.65, drive: 1.3, gain: 0.7 } with no harmonics";
/** Hits (drum, fx and foley instruments) that pitchOf() models; the tonal ones (acid, pulse, vox) play lines. */
const HITS = new Set(['kick', 'e808', 'logdrum', 'tom', 'conga', 'taiko', 'snare', 'boom', 'sweep', 'downlifter', 'bloop', 'squish', 'gel', 'boing', 'bubble']);
const fmt = x => +(+x).toFixed(3);
const hz = m => 440 * Math.pow(2, (m - 69) / 12);

/** A pitch move from f0 to f1 Hz taking `sec` seconds, on a sound whose tail lasts `tail` seconds. */
function move(f0, f1, sec, tail, what) {
  if (!(f0 > 0) || !(f1 > 0) || f0 === f1) return null;
  return { sec, down: f0 > f1, semis: fmt(Math.abs(12 * Math.log2(f0 / f1))), lowHz: fmt(Math.min(f0, f1)), tail, what };
}

/**
 * Every way an event's pitch moves, as the instrument really plays it (instruments.mjs): [{ sec (how long the move
 * takes, s), down (true = falls), semis, lowHz (its lowest pitch), tail (s), what }]. [] = a steady pitch.
 */
export function pitchOf(e) {
  const p = e.params ?? {}, note = e.note ?? (Array.isArray(e.notes) ? e.notes[0] : undefined) ?? p.note;
  const dur = e.dur ?? p.dur, out = [];
  const push = m => m && out.push(m);
  const glide = (dflt, sec, tail, slide = true) => {   // a from / slide glide onto the note
    const n = note ?? dflt, from = p.from != null ? p.from : slide && p.slide ? n + p.slide : null;
    if (from != null) push(move(hz(from), hz(n), sec, tail, p.from != null ? `from ${fmt(from)} to ${fmt(n)}` : `slide ${fmt(p.slide)}`));
  };
  switch (e.inst) {
    case 'kick': {
      const f0 = p.f0 ?? KICK_DEFAULTS.f0, f1 = p.f1 ?? KICK_DEFAULTS.f1;
      push(move(f0, f1, p.pitchTau ?? KICK_DEFAULTS.pitchTau, p.decay ?? KICK_DEFAULTS.decay, `pitch ${fmt(f0)} -> ${fmt(f1)} Hz`));
      break;
    }
    case 'e808': glide(36, p.glide ?? 0.08, Math.min(p.decay ?? 1.1, dur ?? 0.6)); break;
    case 'acid': glide(36, p.glide ?? 0.06, dur ?? 0.15, false); break;
    case 'pulse': glide(60, p.glide ?? 0.06, p.decay ? Math.min(dur ?? 0.25, p.decay) : dur ?? 0.25); break;
    case 'logdrum': {
      const n = note ?? 45, drop = p.drop ?? 12, tail = p.decay ?? 0.25;   // dropTime default: instruments.mjs
      glide(45, p.glide ?? 0.06, tail, false);
      push(move(hz(n + drop), hz(n), p.dropTime ?? LOGDRUM_DROP_TIME, tail, `drop ${fmt(drop)} semitones`));
      break;
    }
    case 'tom': { const f = hz(note ?? 45), b = p.bend ?? 0.6; push(move(f * (1 + b), f, 0.04, p.decay ?? 0.2, `bend ${fmt(b)}`)); break; }
    case 'conga': { const f = hz(note ?? 62), b = p.bend ?? 0.4; push(move(f * (1 + b), f, 0.015, p.decay ?? 0.25, `bend ${fmt(b)}`)); break; }
    case 'taiko': { const f = p.f ?? (note != null ? hz(note) : 62); push(move(f * 1.25, f, 0.03, p.decay ?? 1.1, 'bend 0.25')); break; }
    // the snare body's own envelope is fixed at 0.033 s (decay shapes the wires only)
    case 'snare': { const f = p.body ?? 190, d = p.drop ?? 0.3; push(move(f * (1 + d), f, 0.02, 0.033, `body drop ${fmt(d)}`)); break; }
    case 'boom': push(move(122, 32, 1 / (p.fall ?? 9), p.decay ?? 0.43, 'sub drop 122 -> 32 Hz')); break;
    case 'sweep': { const f0 = p.f0 ?? 200, f1 = p.f1 ?? 1200, d = dur ?? 1; push(move(f0, f1, d, d, `sweep ${fmt(f0)} -> ${fmt(f1)} Hz`)); break; }
    case 'downlifter': { const f0 = (p.f0 ?? 6000) * 0.25, f1 = (p.f1 ?? 200) * 0.25, d = dur ?? 1; if ((p.tone ?? 0.4) > 0) push(move(f0, f1, d, d, 'falling tone')); break; }
    case 'bloop': { const f0 = p.f0 ?? 600, f1 = p.f1 ?? 150; push(move(f0, f1, 0.03, p.decay ?? 0.12, `drop ${fmt(f0)} -> ${fmt(f1)} Hz`)); break; }
    case 'squish': { const f = p.f ?? 180, d = dur ?? 0.25; push(move(f, f * 0.65, d, d, `bend ${fmt(f)} -> ${fmt(f * 0.65)} Hz`)); break; }
    case 'gel': { const f = p.f ?? 140, d = dur ?? 0.3; push(move(f, f * 0.7, d, d, `bend ${fmt(f)} -> ${fmt(f * 0.7)} Hz`)); break; }
    case 'boing': { const f0 = p.f0 ?? 150, f1 = p.f1 ?? 600; push(move(f0, f1, 0.12, (dur ?? 0.6) * 0.35, `boing ${fmt(f0)} -> ${fmt(f1)} Hz`)); break; }
    case 'bubble': { const f = p.f ?? 2000; push(move(f, f * (1 + (p.rise ?? 0.4)), p.decay ?? 0.025, p.decay ?? 0.025, 'bubble rise')); break; }
    case 'vox': if (p.bend) { const f = hz(note ?? 60), d = dur ?? 0.5; push(move(f, f * Math.pow(2, p.bend / 12), d * 0.3, d, `bend ${fmt(p.bend)}`)); } break;
    default: break;
  }
  return out;
}

/** The slowest audible pitch move of an event (a semitone or more), or null: { sec, down, semis, lowHz, tail, what }. */
export function glideOf(e) {
  const moves = pitchOf(e).filter(m => m.semis >= 1);
  return moves.length ? moves.reduce((a, b) => (b.sec > a.sec ? b : a)) : null;
}

/**
 * The check. events: the composed events ({ voice, inst, t, dur, note, params, cue, cueKind }); voices: music.mjs
 * voices ({ <name>: { inst, harmonics, ... } }); duckBy: the voice names mix.duck.by ducks the mix on ([] = no duck).
 * Returns { status, summary, issues: [{ voice, kind, msg, t, count }], counts, gliding (voices whose pitch moves),
 * approved, limits }.
 */
export function checkKick({ events, voices = {}, duckBy = [] }) {
  const issues = new Map();   // one line per voice and kind: every reason its hits gave, the first time, how many hits
  const add = (voice, kind, t, head, why, tail) => {
    const k = `${voice}\u0000${kind}`, r = issues.get(k);
    if (r) { r.count++; for (const w of why) r.why.add(w); return; }
    issues.set(k, { voice, kind, t: fmt(t), count: 1, head, why: new Set(why), tail });
  };
  const where = e => (e.cue ? `the ${e.cueKind ? `${e.cueKind} ` : ''}cue (${e.voice})` : e.voice.startsWith('inst:') ? 'a raw instrument hit' : `voice "${e.voice}"`);
  const hasHarm = v => v && v.harmonics != null && v.harmonics !== false;
  const harmText = v => `a harmonics layer (${typeof v.harmonics === 'object' ? 'on' : v.harmonics} dB)`;
  const ducks = new Set(duckBy);
  let kicks = 0;
  const gliding = new Set();   // voices whose pitch moves (no harmonics layer on them)
  const thumps = new Map();    // voice -> the sliding thumps it plays (failed once it plays THUMP_REPEATS)
  for (const e of events) {
    const raw = e.voice.startsWith('inst:'), v = raw ? null : voices[e.voice], p = e.params ?? {}, g = glideOf(e);
    if (v && g) gliding.add(e.voice);
    const slow = g && g.sec > MAX_PITCH_TAU;
    const named = !raw && KICK_NAME.test(e.voice), ducking = !raw && !e.cue && ducks.has(e.voice);
    if (e.inst === 'kick' || named || ducking) {
      kicks++;
      const why = [];
      if (e.inst === 'kick') {
        const tau = p.pitchTau ?? KICK_DEFAULTS.pitchTau, dec = p.decay ?? KICK_DEFAULTS.decay;
        if (tau > MAX_PITCH_TAU) why.push(`pitchTau ${fmt(tau)} s > ${MAX_PITCH_TAU} (a slow, audible pitch slide)`);
        if (dec > MAX_DECAY) why.push(`decay ${fmt(dec)} s > ${MAX_DECAY} (a long tail)`);
      } else if (e.inst === 'e808') {
        const dec = p.decay ?? 1.1, dur = e.dur ?? p.dur ?? 0.6;
        if (g) why.push(`a ${g.what} glide (an 808 glide is the rubber band)`);
        if (Math.min(dec, dur) > MAX_DECAY) why.push(`it rings ${fmt(Math.min(dec, dur))} s > ${MAX_DECAY}`);
      } else if (e.inst === 'sub') {
        const dur = e.dur ?? p.dur ?? 0.25;
        if (dur > MAX_DECAY) why.push(`a sub held ${fmt(dur)} s > ${MAX_DECAY} (a sub is not a kick)`);
      } else {
        if (slow) why.push(`a ${g.what} (${g.semis} semitones) lasting ${fmt(g.sec)} s > ${MAX_PITCH_TAU}`);
        const tail = g ? g.tail : typeof p.decay === 'number' ? p.decay : null;
        if (tail != null && tail > MAX_DECAY) why.push(`a tail of ${fmt(tail)} s > ${MAX_DECAY}`);
      }
      if (hasHarm(v)) why.push(`${harmText(v)} that slides with its pitch`);
      const role = e.inst === 'kick' || named ? '' : ' ducks the mix (mix.duck.by), so it is the kick, and it';
      if (why.length) add(e.voice, 'kick', e.t, `${where(e)} (${e.inst})${role} is an elastic kick`, why, `Use the approved kick: ${APPROVED_TEXT}`);
      continue;
    }
    if (e.inst === 'e808' && g && ((g.down && slow) || e.cue || raw)) {
      add(e.voice, 'slide', e.t, `${where(e)} (e808) slides on a hit, the rubber band`, [`a ${g.what} glide over ${fmt(g.sec)} s`, ...(hasHarm(v) ? [`${harmText(v)} that slides with it`] : [])], `Play the hit steady (no from / slide / porta), or use the approved kick for the thump: ${APPROVED_TEXT}`);
      continue;
    }
    if (HITS.has(e.inst) && slow && g.semis >= THUMP_SEMIS && g.lowHz <= THUMP_HZ && g.tail > MAX_DECAY) {
      const list = thumps.get(e.voice) ?? [];
      list.push({ e, g });
      thumps.set(e.voice, list);
    }
    if (hasHarm(v) && g) add(e.voice, 'harmonics', e.t, `voice "${e.voice}" (${e.inst}) has a harmonics layer and its pitch moves, so the layer slides with it (the elastic sound)`, [`${g.what} (${g.semis} semitones) over ${fmt(g.sec)} s`], 'Take harmonics off this voice, or keep its pitch steady (no from / slide / porta / bend / drop)');
  }
  for (const [voice, list] of thumps) {
    if (list.length < THUMP_REPEATS) continue;
    for (const { e, g } of list)
      add(voice, 'thump', e.t, `${where(e)} (${e.inst}) is the elastic kick under another name: a sliding thump played as a beat`,
        [`a ${g.what} (${g.semis} semitones, down to ${g.lowHz} Hz) lasting ${fmt(g.sec)} s > ${MAX_PITCH_TAU}`, `a tail of ${fmt(g.tail)} s > ${MAX_DECAY}`],
        `Keep its pitch steady or its slide <= ${MAX_PITCH_TAU} s and its tail <= ${MAX_DECAY} s, play it at most ${THUMP_REPEATS - 1} times as an impact, or use the approved kick for the beat: ${APPROVED_TEXT}`);
  }
  const list = [...issues.values()].sort((a, b) => a.t - b.t).map(({ head, why, tail, ...r }) =>
    ({ ...r, msg: `${head}: ${[...why].slice(0, 4).join(', ')}${why.size > 4 ? ` and ${why.size - 4} more` : ''}. ${tail} (${r.count > 1 ? `${r.count} hits, the first at ${r.t} s` : `at ${r.t} s`})` }));
  const counts = { kick: 0, thump: 0, slide: 0, harmonics: 0 };
  for (const r of list) counts[r.kind] += 1;
  const status = list.length ? 'FAIL' : 'PASS';
  const summary = status === 'PASS'
    ? `${kicks} kick hits, every one tight (pitchTau <= ${MAX_PITCH_TAU} s, decay <= ${MAX_DECAY} s, no harmonics layer); no sliding thump on a beat, no sliding 808 hit, no harmonics on a gliding voice`
    : `${list.map(r => `${r.kind} "${r.voice}"`).join('; ')}: elastic kick sounds the owner rejected. The approved kick: ${APPROVED_TEXT}`;
  return { status, summary, issues: list, counts, gliding: [...gliding].sort(), approved: APPROVED_KICK, limits: { pitchTau: MAX_PITCH_TAU, decay: MAX_DECAY, thumpHz: THUMP_HZ, thumpSemis: THUMP_SEMIS, thumpRepeats: THUMP_REPEATS } };
}
