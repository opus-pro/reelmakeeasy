#!/usr/bin/env node
// Vendored into ReelMakeEasy from the claude-motion-reel skill's composer; what changed here is in README.md.
// Original score + cue sound design for THIS reel, composed from ./music.mjs (data written per reel) against
// build/cues.json (optional: written by hand from the reel's plan). No presets, no defaults that make music: without a music.mjs it refuses.
// Instruments, grids, harmony and effects live in tools/audio/*.mjs. Everything is deterministic (seeded).
// Masters with two-pass loudnorm, then measures: loudness, true peak, mono fold, phone band, silences, gap depth,
// onset-vs-cue alignment, the ending (ring | button | loop), per-section loudness, plus a waveform/spectrogram image.
//   node tools/score.mjs --help   (full music.mjs schema)      node tools/score.mjs --list   (instruments + cue kinds)
import fs from 'fs'; import path from 'path'; import { spawnSync } from 'child_process'; import { pathToFileURL } from 'url';
import { SR, limit, biquad } from './audio/dsp.mjs';
import { loadSpec, compose, MusicError, lib, PICTURE_ONLY } from './audio/compose.mjs';
import { describe } from './audio/instruments.mjs';
import { CUE_DOC, BUS_KINDS } from './audio/cues.mjs';
import { INSERT_DOC } from './audio/fx.mjs';
import { SCALES } from './audio/theory.mjs';
import { meterInfo } from './audio/rhythm.mjs';

const ROOT = process.cwd();
const argv = process.argv.slice(2).flatMap(a => /^--[\w-]+=/.test(a) ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a]); // --k=v is --k v
const has = k => argv.includes(k);
const opt = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] !== undefined && !/^--[a-z]/.test(argv[i + 1]) ? argv[i + 1] : d; };
const FF = process.env.FFMPEG || 'ffmpeg';
const die = (m, code = 1) => { console.error(m); process.exit(code); };
const rel = p => path.relative(ROOT, p).replace(/\\/g, '/');

const TARGETS = { youtube: [-14, -1], social: [-14, -1], streaming: [-14, -1], spotify: [-14, -2], apple: [-16, -1], keynote: [-16, -1], event: [-16, -1], ebu: [-23, -1], atsc: [-24, -2] };

const HELP = `score.mjs: compose THIS reel's music.mjs against build/cues.json, master it, measure it.

USAGE (run from the reel folder)
  node tools/score.mjs                      full score -> audio/score.wav (+ .mp3), build/music.json, qc/audio.png, qc/score-report.json
  node tools/score.mjs --list               instruments with parameters, voice inserts, cue kinds, scales
  --music <file>        default: config.audio.music, else ./music.mjs (a sketch: --music sketch/music.mjs)
  --cues <file>         default build/cues.json (missing -> sketch mode: no cue sounds; sections need bars)
  --no-cues             ignore build/cues.json (pure music sketch)
  --out <file.wav>      default audio/score.wav (the raw float mix goes beside it as <name>-raw.wav)
  LISTENING SLICES (one of these; >= 3 s measures best; build/music.json is not written). Every time a slice prints or
  writes (silences, gaps, onsets, the ending) is REEL time, as in build/timing.txt, never time from the slice's start.
  A slice that holds the final hit (button) or the reel's end (ring) has the ending, as the full score does, and the
  ending check runs on it; the button line names the events its gate cuts (a sonic logo after the final hit).
  --around <section|#index|bar|signature> [--seconds S | --bars N]   about S seconds (default 10) in whole bars, N =
                        round(S / bar length), at least 2 (4/4 at 64 BPM: 3 bars; 120: 5; 150: 6), or exactly N bars,
                        around the HIT of a music section (name), a picture section (label or scene id from
                        build/cues.json, or its index written #2 or section:2, counting from 0) or the signature (the
                        picture sections marked signature: true): its first boom / final / lock cue with s >= .45, else
                        its strongest cue (largest s), else its start. A bare number is bar B (bars count from 1, as in
                        build/timing.txt), never an index. The window starts on a bar line N/2 bars before the hit's
                        bar: the run-up AND the landing are in it (near the reel's edges it shifts inside and says so).
  --from-bar B [--seconds S | --bars N]   from bar B (1-based, build/timing.txt), about S s (default 10) or N bars
  --section <name> [--bars N]   from the start of that music section (its whole length, or N bars)
  --bars N              bars 1..N from the top        --window a-b    seconds a to b
  A sketch: node tools/score.mjs --no-cues --around <section> --out audio/sketch.wav (the hit of one section, in context)
  A slice writes audio/sketch.wav unless --out names another file; never audio/score.wav (ReelMakeEasy takes that file
  as the whole score build/music.json describes).
  (planned sections contribute the cues written on them in reel.config.mjs, so the gap and the hit are in the sketch).
  Iteration 3: the old default of 8 bars was the whole reel at 64-80 BPM.
  AUDITION (a listening aid, not a master: the full mix's master gain, a peak safety limit, no QC, no music.json)
  --solo v1,v2          only these: music.mjs voice names, 'cues' (every cue-sheet sound), inst:<instrument> (step() and
                        section-fx sounds such as inst:riser)          --mute v1,v2   everything except these
                        default out: audio/audition-solo-<names>.wav; combine with a slice (--around ...). An --out that
                        names audio/score.wav or audio/sketch.wav is refused (iteration 3: it overwrote the sketch).
  --ending ring|button|loop    override config.audio.ending
  --lufs N --tp N       loudness target (default config.audio.lufs ?? -14 LUFS, config.audio.tp ?? -1 dBTP)
  --target youtube|social|streaming|spotify|apple|keynote|event|ebu|atsc   preset pairs (--lufs/--tp win; config.audio.target too)
  --seed N              override the music.mjs seed (humanize, random arps, textures): a re-roll of the same structure
  --stems               also write audio/stems/{beat,music,sfx}.wav (float, the master's gain, unlimited); with a slice
                        or --out: audio/stems/<out name>-{beat,music,sfx}.wav, cut to the same slice
  --stem sfx            only the cue sound-design layer -> audio/sfx.wav (under an external track; works with sections: [])
  --mux [out.mp4]       the newest of exports/silent.mp4 and exports/draft-*.mp4 + audio/score.wav -> exports/reel.mp4
                        (a draft: exports/reel-draft-<a>-<b>.mp4, the score cut from the draft's start a) (aac 320k)
  --no-master           write the raw mix only (no loudnorm, no QC) · --no-png · --no-mp3 · --json (report to stdout) · --quiet
  Exit 0 = written (WARN lines are advice) · 1 = refused / error · 3 = a QC check FAILED (true peak or ending).

MUSIC.MJS (data; every value is a decision for THIS reel, nothing is filled in for you)
  export default {                       // or export default (ctx) => ({...}); ctx = { sheet, T, lib, config }
    bpm, meter,                          // read both from reel.config.mjs (picture and sound share one grid); bpm counts quarters
    stepsPerBar | steps,                 // grid cells per bar: 16 in 4/4, 12 = triplet grid, 14 in 7/8, 24 = 16th triplets
    key, mode | scale,                   // tonic ('F#', 'Bb') + mode name or semitone array; required once anything is pitched
    seed,                                // integer: humanize / arp / texture randomness (deterministic)
    instruments | voices: { <voice>: { type | inst: <instrument>, ...params } },
    grids: { <set>: { <voice>: <pattern> } },   byEnergy: { <energy>: <set> },   grid: <default set>,
    progression: [<chord>, ...], chordBars: 1, progressionMode: 'section' | 'global',
    motif: { degrees: [...], rhythm: '<grid>', voice, steps?, octave?, gate?, legato? },
    sections: [ {...} ] | 'picture',
    notes: [ { voice, bar, beat | at, deg | tone | note | notes | chord, dur | beats | steps, vel } ],   // bar from 0
    cues: { <cue kind>: false | '<voice>' | { voice, ... } | { type: <instrument>, ... } | (c, api) => {} },
    fx: [ { kind, at | bar(+beat), dur | bars | beats, bus, ... } ],          // global bus effects
    mix: { duck, reverb, reverbBus, delay, hp, monoBelow, width, drive, tape, gapBefore },
    start, buttonAt, buttonGate, ringFade,
  };
  export function step(ctx) {}           // optional escape hatch, called once per grid cell (STEP below)

  VOICE keys (composer): type|inst gain pan send (reverb) dsend (delay) bus ('beat'|'music'|'sfx') octave low (lowest MIDI
    of the chord-tone register) transpose swing human{ms,vel} offset (ms, + = late) gate (0..1 of the cell) notes voicing
    ('close'|'spread'|'shell') center size steps (own grid resolution) velMap{X,x,o} mono|choke (true | 'group') minEnergy
    maxEnergy fx:[inserts] velHold arpOctaves notesReset ('bar')
    harmonics (true | dB | { db -8, input 120, hp 200, lp 3500 }: a parallel exciter on a monophonic low voice: harmonics
      2-12 of its fundamental, phase-designed so the voice's peak barely grows, kept above 200 Hz in mono, so phone
      speakers play the line; the sub is untouched. db = their level under the voice's RMS)
    porta (true | 'legato': each note glides from the voice's previous note; acid e808 logdrum pulse, glide time = their
      own glide parameter (acid, logdrum: 60 ms); 'legato' glides only out of a note still sounding).
    Every other key goes to the instrument (--list); a
    function value is called per note with ctx { t, energy, section, bar, step, absStep, vel, chord, T } (automation).
  PATTERN: '<grid string>' | 'hold' (one note/chord per chord change, held) | { grid, steps, notes, swing, vel, gain, pan,
    phase: 'global' (polymeter counted from the start, not the section), rotate, octave, gate, ...instrument params }
    | { hold: true, gain, velHold, notes, ... } (a held pattern with keys; { grid: 'hold', ... } means the same)
  GRID STRING: one char per cell; '|' and spaces are ignored.  X accent 1.0 · x hit .75 · o ghost .35 · . or - rest ·
    _ tie (lengthens the previous hit).  Pitched voices: R root · 3 · 5 · 7 · 9 · O octave · A approach (a semitone below
    the next chord's bass) · C whole chord.  Macros: E(k,n[,rot][,X|x|o]) Euclid · 'a+b' concatenate · 'a*3' repeat.
    Its length is its cycle: stepsPerBar cells loop each bar, 2x = a 2-bar phrase, any other length drifts (polymeter).
  NOTES (pitched voices without chord tokens): [degrees] cycled (0 = tonic, 7 = the octave in a 7-note mode, -1 = below,
    '3.5' microtonal), ['Eb4', ...], or 'up' | 'down' | 'updown' | 'random' arpeggios over chord tones.  None = 'up'.
  SWING: Linn swing s (0.5 straight · ~0.54 loosens · ~0.58 light · 0.66 triplet feel · 0.75 dotted): the 2nd cell of
    each pair is late by (2s-1) x cell. Per voice, per pattern, section.swing{voice}, or top-level swing{<voice>, default}.
    Applies only when a beat holds an even number of cells (not on a 12-cell triplet grid).
  HUMANIZE: human: { ms, vel } (seeded jitter) per voice/pattern, or humanize: { <voice>: {...}, default: {...} } | {ms, vel}.
  METER: '4/4' '3/4' '6/8' '12/8' '5/4' '7/8' '9/8' ... or a number of quarter beats (3.5 = 7/8). Bars follow the meter.
  BAR NUMBERS: inside music.mjs every bar key (notes[].bar, fx bar, section fx bar, motif bar) is an OFFSET counted from 0:
    bar 0 = the first bar (of the reel, or of the section for section keys), and beat 0 = its downbeat. The command line
    (--around B, --from-bar B) and build/timing.txt (bar.beat) count from 1. So 9.3 in timing.txt is
    notes: [{ bar: 8, beat: 2, ... }]; a note past the end is dropped with a WARN.
  FOUND SOUNDS (M26): modal shape 'plate' | 'ring' | 'tube', rattle, scrape (--list), and in music.mjs
    import { plateHz, tubeHz, OBJECT_MATERIALS } from './tools/audio/instruments.mjs' for an object's pitch from its size.
  SECTION keys: name · bars | beats | dur | at | until: 'end' | picture: <index|label> · energy (0..4; the picture's when
    mirrored) · grid (set name or inline {voice: pattern}) · add (a set merged on top) · play ({voice: pattern | 'motif' |
    'motif:<transform>'}, or [voices] = only) · only · mute · prog | progression · chordBars · key · mode · transpose · swing
    · motif (true | '<transform>' | { voice, transform, bar, beat, every, times }) · fill ({ grid: <set>, every: 4 | bars: [..]
    | last: true }; a voice set to null in the fill set is muted in those bars) · fx (strings below, or bus-fx objects).
    sections: 'picture' mirrors build/cues.json sections (name, length, energy) and picks each grid via byEnergy.
  SECTION FX strings: gap | gap<N> (silence the last 1/N note: gap16, gap8, gap4) · tapestop · stutter (last beat) ·
    bitcrush · filter | lpclose · lpopen · hpopen (across the section) · reverse (swell into the section end) · granular ·
    shepard · riser (last bar) · downlifter (first bar).  Objects: { kind, bar, beat, dur | bars | beats, ... } with a bus
    kind (gap tapestop bitcrush reverse granular filter stutter) or any instrument name (played on the sfx bus).
  CHORDS: Roman numerals relative to the mode ('I', 'vi7', 'bVII', 'IVmaj7', 'V/IV', 'II>I' = II over the I bass,
    'Imaj7#11'), diatonic numbers (1, '4^7', '2^9'), names ('Ebmaj9', 'C#m7', 'D/C'), MIDI arrays (literal), '-' = none.
  MOTIF transforms: retro · invert · aug · dim · shift:<n>, combined with '+' ('invert+aug'). Derive it (music-direction.md).
  MIX: duck { by: [voices or cue kinds], depth .4, beats .6, targets: ['music'] } · reverb { size .83, damp .32, wet .85 }
    · reverbBus { beat|music|sfx: scale } · delay { beats .75, fb .35, lp 3500, wet 1, spread 1 } · hp 25 · monoBelow 120
    · width 1 · drive 0 (master tanh) · tape { wow %, flutter % } · gapBefore { kinds: ['boom', 'final'], steps: 1 | sec,
    keep: [bus] }: a gap cue before each cue of those kinds, so it silences every bus, reverb tails included, as the gap
    cue does (keep: ['sfx'] leaves that bus playing through it; until iteration 4 it spared sfx and its tails).
    A gap that swallows a note's onset while the note sounds on past the gap is a WARN naming the voice and time.
  CUES: every cue kind in build/cues.json that --list names gets a default sound; the defaults are generic placeholders
    pitched from this reel's key. Re-voice the kinds your reel uses (one material family, music-direction.md); false =
    silent. A kind --list does not name (a scene's own 'seal', 'stand' ...) is SILENT, with one WARN per kind, until
    music.mjs cues.<kind> voices it (or cues.<kind>: false says it is picture-only). Bus-effect kinds (gap, tapestop,
    bitcrush, reverse, granular, filter, stutter) process the music already playing: { kind: 'gap', t, d } silences [t, t+d)
    on every bus (keep: ['sfx'] or bus: 'music' to spare or pick buses). One cue louder or softer: its g in the scene's
    cues() ({ kind: 'boom', t, g: 0.6 }), or every cue of a kind: cues: { boom: { type: 'boom', gain: 0.6 } } in music.mjs.
    api in a cue function: inst(name, params) · play(voice, {deg | tone | note | chord, dur, vel, t}) · chordAt(t) ·
    cueNote(deg) · duration · T · rand (seeded).  cueScale / cueOctave / cueCenter retune the defaults.
  ENDING (config.audio.ending): ring = rings out, audio.ringFade (0.5 s) cosine fade at the very end · button = silent
    buttonGate (default 0.012 s: a dead stop) after the final hit (cue 'final', else the last cue with s >= .6, else buttonAt) ·
    loop = renders audio.loopTail (4 s) past the end and folds it into the head; make the reel whole bars.
  STEP(ctx): { t, absStep, step, bar, beat, section, sectionBar, energy, chord {root, ints, symbol, notes}, key, scale, T,
    stepSec, barSec, stepsPerBar, rng, lib {euclid, parseNote, nameOf, mtof, degree, parseChord, expandGrid},
    play(voice, {deg | tone | note | notes | chord, dur | beats | steps, vel, at}), inst(name, {...params, at}), cuesNear(dt) }.
  Not supported (engine P2): tempo maps / ramps. One bpm per reel; build an accelerando with cut density and arrangement.

OUTPUTS
  audio/score-raw.wav  float mix before mastering       audio/score.wav  48 kHz 16-bit, two-pass loudnorm (+ score.mp3)
  build/music.json     sections, chords, hits per voice and control signals at 120 Hz (level, beat, music, sfx, low, high,
                       energy, riser, fall, filter, duck) for the picture. In a scene's async create():
                       const M = await fetch('build/music.json').then(r => r.json()).catch(() => null)
  qc/audio.png         waveform over a log spectrogram; yellow lines = sections, red ticks = hero cues
  qc/score-report.json loudness, true peak, LRA, mono fold, phone band, silences, gap depth, onset offsets, ending check
Verified by measurement only: say so, and ask the user to listen to the hook, the drop and the ending.`;

if (has('--help') || has('-h')) { console.log(HELP); process.exit(0); }
if (has('--list')) {
  console.log(describe());
  console.log('\nVOICE INSERTS (voice fx: [ {type, ...} ], applied in order)');
  for (const [k, v] of Object.entries(INSERT_DOC)) console.log(`  ${k.padEnd(11)} ${v}`);
  console.log('\nVOICE KEYS FOR PHONES AND GLIDES (composer keys on a voice, not instrument parameters; all keys: --help)');
  console.log('  harmonics   true | dB (-8) | { db -8, input 120, hp 200, lp 3500 }: parallel exciter for a monophonic low voice:');
  console.log('              its harmonics 2-12 above 200 Hz, in mono, so phone speakers play it (the phone QC names the voice)');
  console.log('  porta       true | \'legato\': each note glides from the previous note (acid e808 logdrum pulse; time = their glide)');
  console.log('\nCUE KINDS (build/cues.json kind -> default sound; re-voice with music.mjs cues.<kind>)');
  for (const [k, v] of Object.entries(CUE_DOC)) if (!BUS_KINDS.has(k)) console.log(`  ${k.padEnd(11)} ${v}`);
  console.log('\nBUS-EFFECT CUE KINDS (process what is already playing; also usable as music.mjs fx objects)');
  for (const k of BUS_KINDS) console.log(`  ${k.padEnd(11)} ${CUE_DOC[k] ?? ''}`);
  console.log('  e.g. a designed silence before a hit: cues() returns { kind: \'gap\', t: hit - T.s16(2), d: T.s16(2) }');
  console.log('\nOTHER KINDS');
  console.log('  transition, flash: picture only (silent unless voiced in music.mjs cues)');
  console.log('  any other kind (a scene\'s own, e.g. seal, stand): SILENT, one WARN per kind; voice it with music.mjs');
  console.log('              cues.<kind> (a voice name, { type: <instrument>, ... }, or (c, api) => {}), or cues.<kind>: false');
  console.log(`\nSCALES / MODES\n  ${Object.keys(SCALES).join(' · ')}  (or an array of semitones)`);
  process.exit(0);
}

// ------------------------------------------------------------------ inputs
const log = (...a) => { if (!has('--quiet')) console.log(...a); };
async function readConfig() {
  const p = path.join(ROOT, 'reel.config.mjs');
  if (!fs.existsSync(p)) return null;
  try { return (await import(pathToFileURL(p).href)).default; } catch (e) { console.warn(`(could not import reel.config.mjs: ${e.message})`); return null; }
}
const config = await readConfig();
const cuesPath = path.resolve(ROOT, opt('--cues', 'build/cues.json'));
let sheet = null;
if (!has('--no-cues')) {
  if (fs.existsSync(cuesPath)) {
    sheet = JSON.parse(fs.readFileSync(cuesPath, 'utf8'));
    const scenesDir = path.join(ROOT, 'scenes');
    const newer = [path.join(ROOT, 'reel.config.mjs'), ...(fs.existsSync(scenesDir) ? fs.readdirSync(scenesDir).filter(f => f.endsWith('.js')).map(f => path.join(scenesDir, f)) : [])]
      .filter(f => fs.existsSync(f) && fs.statSync(f).mtimeMs > fs.statSync(cuesPath).mtimeMs + 1000);
    if (newer.length) console.warn(`WARNING: ${rel(cuesPath)} is older than ${newer.map(rel).slice(0, 3).join(', ')}: write it again from the plan first.`);
  } else log(`(no ${rel(cuesPath)}: sketch mode, no cue sounds; a cue sheet written from the plan adds them)`);
}
const audioCfg = { ...(config?.audio || {}), ...(sheet?.audio || {}) };
const musicRel = opt('--music') ?? (typeof audioCfg.music === 'string' ? audioCfg.music : './music.mjs');
const musicPath = path.resolve(ROOT, musicRel);
if (!fs.existsSync(musicPath))
  die(`score.mjs refuses: no ${rel(musicPath) || musicRel} here, and there are no default presets.\n` +
    `Write one for this reel (the composer skill: references/music-direction.md, then music-synthesis.md; schema: node tools/score.mjs --help).`);

const STEM = opt('--stem');
if (STEM && !['sfx', 'beat', 'music'].includes(STEM)) die('--stem takes sfx | beat | music');
let spec;
try {
  const tb = sheet ?? config;
  let T = null;
  if (tb && Number(tb.bpm) > 0) { const m = meterInfo(tb.meter ?? '4/4'), sb = 60 / tb.bpm; T = { bpm: +tb.bpm, beat: n => n * sb, bar: n => n * m.beatsPerBar * sb, s16: n => n * sb / 4, beatsPerBar: m.beatsPerBar, stepsPerBar: m.stepsPerBar }; }
  spec = await loadSpec(pathToFileURL(musicPath).href + `?t=${fs.statSync(musicPath).mtimeMs}`, { sheet, T, lib, config });
} catch (e) { die(`music.mjs failed to load: ${e instanceof MusicError ? e.message : e.stack || e.message}`); }
if (Array.isArray(spec.sections) && !spec.sections.length && STEM !== 'sfx')
  die(`score.mjs refuses: ${rel(musicPath)} is still blank (sections: []). Nothing makes music by default.\n` +
    `Compose it (node tools/score.mjs --help).`);
if (opt('--seed') != null) spec.seed = +opt('--seed');

const endingOpt = opt('--ending') ?? undefined;
const tgt = opt('--target') ?? audioCfg.target ?? null;
if (tgt && !TARGETS[tgt]) die(`--target ${tgt} unknown: ${Object.keys(TARGETS).join(' | ')}`);
const LUFS = +(opt('--lufs') ?? (opt('--target') ? TARGETS[tgt][0] : audioCfg.lufs ?? (tgt ? TARGETS[tgt][0] : -14)));
const TP = +(opt('--tp') ?? (opt('--target') ? TARGETS[tgt][1] : audioCfg.tp ?? (tgt ? TARGETS[tgt][1] : -1)));
if (!Number.isFinite(LUFS) || !Number.isFinite(TP)) die('--lufs / --tp must be numbers');

// ------------------------------------------------------------------ compose
const list = k => (opt(k) ?? '').split(',').map(s => s.trim()).filter(Boolean);
const SOLO = list('--solo'), MUTE = list('--mute'), AUDITION = !!(SOLO.length || MUTE.length) && !STEM;
if ((has('--solo') && !SOLO.length) || (has('--mute') && !MUTE.length)) die('--solo / --mute take comma-separated names: music.mjs voices, cues, inst:<instrument>');
if (AUDITION && has('--stems')) die('--stems and --solo/--mute: choose one (stems are per bus; solo/mute is per voice).');
const SLICES = ['--window', '--around', '--from-bar', '--section'].filter(has);
if (SLICES.length > 1) die(`choose one slice: ${SLICES.join(' and ')} together is ambiguous`);
let res;
const t0 = performance.now();
const PROBE = !STEM && !AUDITION && !has('--no-master');      // per-voice dry signals for the phone-band breakdown
try { res = compose(spec, sheet, { ending: endingOpt, audio: audioCfg, onlyBus: STEM ?? undefined, allowNoMusic: STEM === 'sfx', solo: SOLO, mute: MUTE, probe: PROBE }); }
catch (e) { die(e instanceof MusicError ? `music.mjs: ${e.message}` : (e.stack || e.message)); }
const ms = performance.now() - t0;
const { info } = res;
let L = res.L, R = res.R;
const DUR = info.duration;

// slice for a listening sketch
let win = null, winWhy = '';
const nBars = opt('--bars') != null ? +opt('--bars') : null;
if (nBars != null && !(nBars > 0)) die('--bars N: a positive number of bars');
const secs = opt('--seconds') != null ? +opt('--seconds') : null;
if (has('--seconds') && !(secs > 0)) die('--seconds S: a positive number of seconds');
if (secs != null && nBars != null) die('--seconds and --bars: choose one (seconds become whole bars at this tempo)');
// --around / --from-bar: about 10 s (or --seconds) in whole bars at this tempo; 8 bars was the whole reel at 64-80 BPM
const autoBars = Math.max(2, Math.round((secs ?? 10) / info.barSec));
const NB = nBars ?? autoBars, NBwhy = nBars != null ? `${NB} bars` : `${NB} bars (about ${secs ?? 10} s at ${+info.bpm.toFixed(2)} BPM: ${(NB * info.barSec).toFixed(2)} s)`;
const span = NB * info.barSec;
let shifted = '';
const fit = a => { const a1 = Math.max(0, Math.min(a, DUR - Math.min(span, DUR))); if (Math.abs(a1 - a) > 1e-6) shifted = ` (shifted ${(a1 - a).toFixed(2)} s to stay inside the reel)`; return [a1, Math.min(DUR, a1 + span)]; };   // keep N bars inside the reel
if (opt('--window')) { const [a, b] = opt('--window').split('-').map(Number); if (!(b > a)) die('--window a-b in seconds'); win = [Math.max(0, a), Math.min(b, DUR)]; }
else if (has('--around')) {
  const key = opt('--around'); if (key == null) die('--around needs a music section name, a picture section label/scene, #index (or section:index), signature, or a bar number (from 1)');
  const pics = sheet?.sections ?? [];
  let at = null, what = '';
  // a picture section by index has its own syntax (#2, section:2): a bare number was always read as a bar, so the
  // "index" the help promised could never be reached (iteration 3: --around 2 centred on bar 2, not section 2)
  const idx = String(key).match(/^(?:#|section:)(\d+)$/i);
  if (idx && !pics.some(x => String(x.index) === idx[1])) die(`--around ${key}: no picture section ${idx[1]} in ${sheet ? rel(cuesPath) : 'build/cues.json (missing)'}${pics.length ? ` (indexes ${pics.map(x => `${x.index} ${x.label}`).join(', ')})` : ''}`);
  if (!idx && /^\d+$/.test(key) && !info.sections.some(x => x.name === key) && !pics.some(x => x.label === key)) {
    if (+key < 1) die('--around <bar>: bars count from 1 (build/timing.txt)');
    // a bar past the end was moved to the last bars without a word (iteration 4 repair): refused, like #9 for a section
    const lastBar = Math.max(1, Math.ceil(DUR / info.barSec - 1e-6));
    if (+key > lastBar) die(`--around ${key}: the reel has ${lastBar} bars (${(DUR / info.barSec).toFixed(2)} at ${+info.bpm.toFixed(2)} BPM, ${DUR.toFixed(2)} s); bars count from 1 (build/timing.txt)`);
    at = (+key - 1) * info.barSec; what = `bar ${key}`;
  } else {
    // a section: centre on its hit, not its start (a window centred on the start ended 1.4 s after a mid-section boom)
    let a0, b0;
    if (key === 'signature') {
      const i0 = pics.findIndex(x => x.signature); if (i0 < 0) die(`--around signature: no picture section has signature: true in ${sheet ? rel(cuesPath) : 'build/cues.json (missing)'}`);
      let i1 = i0; while (pics[i1 + 1]?.signature) i1++;               // consecutive signature sections form one span
      a0 = pics[i0].at; b0 = pics[i1].at + pics[i1].dur; what = `the signature section${i1 > i0 ? 's' : ''} "${pics.slice(i0, i1 + 1).map(x => x.label).join('" + "')}"`;
    } else {
      const ms0 = idx ? null : info.sections.find(x => x.name === key);
      const ps = idx ? pics.find(x => String(x.index) === idx[1]) : pics.find(x => x.label === key || x.scene === key);
      if (ms0) { a0 = ms0.at; b0 = ms0.at + ms0.dur; what = `music section "${key}"`; } else if (ps) { a0 = ps.at; b0 = ps.at + ps.dur; what = `picture section "${ps.label}"`; }
      else die(`--around "${key}": no match. Music sections: ${info.sections.map(x => x.name).join(', ')}${pics.length ? ` · picture: ${pics.map(x => x.label).join(', ')}` : ''} · or #index (section:index) · or signature · or a bar number`);
    }
    const h = heroCue(sheet?.cues ?? [], a0, b0);
    at = h ? h.t : a0;
    what = h ? `the ${h.kind} cue (s ${h.s}${h.hero ? '' : ', the strongest'}) of ${what} (${a0.toFixed(2)}-${b0.toFixed(2)} s)` : `the start of ${what} (no impact cue in ${a0.toFixed(2)}-${b0.toFixed(2)} s)`;
  }
  const snap = Math.round(at / info.stepSec) * info.stepSec; if (Math.abs(snap - at) < 0.002) at = snap;   // report times are rounded to ms
  const hitBar = Math.floor(at / info.barSec + 1e-6);                  // whole bars: the hit's bar sits mid-window
  win = fit((hitBar - Math.floor(NB / 2)) * info.barSec); winWhy = `${NBwhy} around ${what} at ${at.toFixed(2)} s (bar ${(at / info.barSec + 1).toFixed(2)})${shifted}`;
} else if (has('--from-bar')) {
  const b = +opt('--from-bar'); if (!(b >= 1)) die('--from-bar B: bars count from 1, as in build/timing.txt');
  const a = (b - 1) * info.barSec; if (a >= DUR - 1e-6) die(`--from-bar ${b}: the reel has ${(DUR / info.barSec).toFixed(2)} bars`);
  win = [a, Math.min(DUR, a + span)]; winWhy = `${NBwhy} from bar ${b}`;
} else if (opt('--section')) {
  const s = info.sections.find(x => x.name === opt('--section')); if (!s) die(`--section "${opt('--section')}" not found: ${info.sections.map(x => x.name).join(', ')}`);
  win = [s.at, Math.min(DUR, s.at + (nBars != null ? nBars * info.barSec : s.dur))]; winWhy = `section "${s.name}"`;
} else if (nBars != null) { win = [0, Math.min(DUR, nBars * info.barSec)]; winWhy = `bars 1-${nBars}`; }
const cut = (x, w) => x.slice(Math.round(w[0] * SR), Math.round(w[1] * SR));
if (win) { L = cut(L, win); R = cut(R, win); }

const tag = AUDITION ? `audition-${SOLO.length ? 'solo-' + SOLO.join('+') : ''}${SOLO.length && MUTE.length ? '-' : ''}${MUTE.length ? 'mute-' + MUTE.join('+') : ''}`.replace(/[^\w+.-]+/g, '_') : null;
// ReelMakeEasy: a slice (--window, --around, --from-bar, --section, --bars) is a sketch by default and never the score:
// ReelMakeEasy takes audio/score.wav as the whole score build/music.json describes
const OUT = path.resolve(ROOT, opt('--out', STEM === 'sfx' ? 'audio/sfx.wav' : STEM ? `audio/${STEM}.wav` : AUDITION ? `audio/${tag}.wav` : win ? 'audio/sketch.wav' : 'audio/score.wav'));
if (win && path.resolve(ROOT, 'audio/score.wav') === OUT)
  die(`a slice (${winWhy}) never overwrites audio/score.wav, the whole score ReelMakeEasy takes. Leave --out off (audio/sketch.wav) or name another file.`);
if (AUDITION && ['audio/score.wav', 'audio/sketch.wav'].some(p => path.resolve(ROOT, p) === OUT))
  die(`--solo/--mute --out ${rel(OUT)}: an audition never overwrites the score or the sketch (iteration 3 lost a sketch this way). Leave --out off (audio/${tag}.wav) or name another file.`);
const RAW = OUT.replace(/\.wav$/i, '') + '-raw.wav';
// scratch files are named after the output, so a sketch (--around ... --out audio/sketch.wav) and a full score can
// render in one project at the same time; one shared name made the second render fail with EPERM on Windows
const SCRATCH = path.basename(OUT).replace(/\.wav$/i, '').replace(/[^\w.+-]+/g, '_');
const TMP_WAV = path.join(ROOT, 'build', `${SCRATCH}-tmp.wav`), LIMITED_WAV = path.join(ROOT, 'build', `${SCRATCH}-limited.wav`);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true }); fs.mkdirSync(path.join(ROOT, 'qc'), { recursive: true });
writeWavF32(RAW, L, R);

log(`composed ${rel(musicPath)}: ${info.bpm} BPM ${info.meter} (${info.stepsPerBar} cells/bar), ${info.key ? `${info.key} ${typeof info.scale === 'string' ? info.scale : '[custom scale]'}` : 'no key'}, ` +
  `${DUR.toFixed(3)} s = ${(DUR / info.barSec).toFixed(2)} bars, ${info.events} events, ending ${info.ending.mode}, seed ${info.seed} (${(ms / 1000).toFixed(1)} s)`);
for (const s of info.sections) log(`  ${String(s.at.toFixed(2)).padStart(6)}s  ${s.name.padEnd(14)} ${String(s.bars).padStart(5)} bars  energy ${s.energy}  ${s.grid}  [${s.voices.join(' ')}]`);
if (info.fx.length) log(`  fx: ${info.fx.map(f => `${f.kind}@${f.t}${f.dur ? `+${f.dur}` : ''}(${f.bus})`).join('  ')}`);
for (const l of info.log) log('  ' + l);
for (const w of info.warnings) console.warn('  WARN ' + w);
if (win) log(`  slice     ${win[0].toFixed(3)}-${win[1].toFixed(3)} s (bar ${(win[0] / info.barSec + 1).toFixed(2)} to ${(win[1] / info.barSec + 1).toFixed(2)})${winWhy ? ': ' + winWhy : ''}`);

if (has('--no-master')) { log(`raw mix -> ${rel(RAW)} (no mastering, no QC)`); process.exit(0); }

// ------------------------------------------------------------------ audition (--solo / --mute): the full mix's gain, no QC
if (AUDITION) {
  let full;
  try { full = compose(spec, sheet, { ending: endingOpt, audio: audioCfg }); } catch (e) { die(e.message); }
  const fl = win ? cut(full.L, win) : full.L, fr = win ? cut(full.R, win) : full.R;
  const m = measureLoud(writeTmp(fl, fr)), g = Math.pow(10, (LUFS - m.input_i) / 20);
  for (let i = 0; i < L.length; i++) { L[i] *= g; R[i] *= g; }
  const ceil = Math.pow(10, (TP - 0.3) / 20); let pk = 0; for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const lim = pk > ceil ? limit(L, R, ceil, { look: 0.004, release: 0.08 }) : 0;
  if (pk === 0) console.warn(`  WARN nothing audible: ${SOLO.length ? `--solo ${SOLO.join(',')}` : ''} ${MUTE.length ? `--mute ${MUTE.join(',')}` : ''} leaves no events${win ? ' in this slice' : ''}`);
  writeWavF32(RAW, L, R);
  ff(['-v', 'error', '-y', '-i', RAW, '-ar', String(SR), '-c:a', 'pcm_s16le', OUT]);
  if (!has('--no-mp3')) ff(['-v', 'error', '-y', '-i', OUT, '-c:a', 'libmp3lame', '-b:a', '320k', OUT.replace(/\.wav$/i, '.mp3')]);
  fs.rmSync(RAW, { force: true }); fs.rmSync(TMP_WAV, { force: true });
  const e = ebur(OUT);
  log(`\naudition -> ${rel(OUT)}${has('--no-mp3') ? '' : ' (+ .mp3)'}: ${SOLO.length ? 'solo ' + SOLO.join(', ') : ''}${SOLO.length && MUTE.length ? ' · ' : ''}${MUTE.length ? 'mute ' + MUTE.join(', ') : ''}` +
    ` at the full mix's master gain (${(20 * Math.log10(g)).toFixed(2)} dB${lim ? `, ${lim} peak samples limited` : ''}): ${e.I} LUFS, true peak ${e.TP} dBTP.` +
    ` A listening aid only: no QC, build/music.json untouched.`);
  process.exit(0);
}

const report = { tool: 'score.mjs', music: rel(musicPath), cues: sheet ? rel(cuesPath) : null, out: rel(OUT), window: win, target: { lufs: LUFS, tp: TP, preset: tgt }, info: { ...info, hits: undefined, chords: undefined, motif: undefined }, checks: [] };
const check = (id, status, msg, data = {}) => { report.checks.push({ id, status, msg, ...data }); const tag = status === 'PASS' ? 'ok' : status === 'INFO' ? '' : status; (status === 'WARN' || status === 'FAIL' ? console.warn : log)(`  ${tag.padEnd(4)} ${id.padEnd(9)} ${msg}`); };

// ------------------------------------------------------------------ stem-only path (cue sounds under an external track)
if (STEM) {
  let g;
  let full = null;
  if (!Array.isArray(spec.sections) || spec.sections.length) { try { full = compose(spec, sheet, { ending: endingOpt, audio: audioCfg }); } catch { full = null; } }
  if (full) { const m = measureLoud(writeTmp(full.L, full.R)); g = Math.pow(10, (LUFS - m.input_i) / 20); log(`stem ${STEM}: carries the full mix's master gain (${(20 * Math.log10(g)).toFixed(2)} dB), no limiter`); }
  else { let pk = 0; for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); g = pk > 0 ? Math.pow(10, -3 / 20) / pk : 1; log(`stem ${STEM}: no music sections, normalised to -3 dBFS sample peak (set its level under the track, then master the sum)`); }
  for (let i = 0; i < L.length; i++) { L[i] *= g; R[i] *= g; }
  writeWavF32(OUT, L, R);
  const m = ebur(OUT);
  log(`-> ${rel(OUT)}  ${m.I} LUFS integrated, true peak ${m.TP} dBTP (float WAV)`);
  fs.rmSync(RAW, { force: true }); fs.rmSync(TMP_WAV, { force: true });
  process.exit(0);
}

// ------------------------------------------------------------------ master: two-pass loudnorm, pre-limited so pass 2 stays linear
const loop = info.ending.mode === 'loop' && !win;
const m0 = measureLoud(RAW);
if (!Number.isFinite(m0.input_i) || m0.input_i < -70) die(`the mix is silent (integrated ${m0.input_i} LUFS): nothing to master. Check sections, grids and energies.`);
// loudnorm pass 2 is linear only if measured_tp + (target - measured_i) <= TP. Limiting costs loudness, which raises
// the gain, so solve for the limiter margin on measurements (fixed point), then run pass 2 once.
const gain0 = LUFS - m0.input_i, offTP0 = m0.input_tp + gain0;
let margin = 0, src = RAW, m1 = m0, limited = 0, solve = [];
if (offTP0 > TP - 0.05) {
  margin = offTP0 - TP + 0.1; src = LIMITED_WAV;
  for (let it = 0; it < 10; it++) {
    const l = L.slice(), r = R.slice(), ceil = Math.pow(10, (m0.input_tp - margin) / 20) * 0.999;   // sample-peak ceiling in raw units
    limited = loop ? limitLoop(l, r, ceil) : limit(l, r, ceil, { look: 0.004, release: 0.08 });
    writeWavF32(src, l, r); m1 = measureLoud(src);
    const offTP = m1.input_tp + (LUFS - m1.input_i); solve.push({ marginDb: +margin.toFixed(2), offTP: +offTP.toFixed(2) });
    if (offTP <= TP - 0.05) break;
    margin += offTP - TP + 0.1;
  }
}
const p2 = loudnorm2(src, OUT, m1), fin0 = ebur(OUT);
const mastered = { gainDb: +(LUFS - m1.input_i).toFixed(2), limiterDb: +margin.toFixed(2), limitedSamples: limited, solve, pass1: m0, pass2: p2, final: { I: fin0.I, LRA: fin0.LRA, TP: fin0.TP }, momentary: fin0.momentary };
fs.rmSync(LIMITED_WAV, { force: true });
const fin = mastered.final;
report.master = { ...mastered, momentary: undefined };
log(`\nmastered -> ${rel(OUT)}  (two-pass loudnorm, pass 2 ${mastered.pass2.normalization_type}, gain ${mastered.gainDb} dB${mastered.limitedSamples ? `, peaks limited by up to ${mastered.limiterDb} dB` : ''})`);
if (mastered.limiterDb > 6) {
  // name the culprits: the peaks the limiter took most off, in reel time, with the voice (dry probe) loudest there.
  // Iteration 3 (clip/new-1): the WARN named no voice or time, and halving two guessed gains moved it 0.1 dB.
  const off0 = win ? win[0] : 0, ceil = Math.pow(10, (m0.input_tp - mastered.limiterDb) / 20);
  const pk = limiterPeaks(L, R, ceil, res.probe, win).filter(p => p.db >= 0.5).map(p => {
    // a cue sound peaks after its onset (a boom's sub swells for ~0.2 s): the latest cue up to 0.6 s before the peak
    const t = p.t + off0, near = p.top[0]?.voice === 'cues' ? (sheet?.cues ?? []).filter(c => c.t <= t + 0.03 && c.t >= t - 0.6 && !BUS_KINDS.has(c.kind) && !PICTURE_ONLY.has(c.kind)).sort((a, b) => b.t - a.t).slice(0, 1).map(c => `${c.kind} cue at ${c.t.toFixed(2)} s`) : [];
    return `${p.db.toFixed(1)} dB at ${t.toFixed(2)} s (${p.top.map(v => `${v.voice === 'cues' && near.length ? near[0] : v.voice} ${v.share} %`).join(', ') || 'no probe'})`;
  });
  const quiet = mastered.gainDb > 12 ? `; the target lifts this mix by ${mastered.gainDb} dB, so most of it is quiet (a silence-led arc puts its hits into the limiter by design: a lower --lufs / audio.lufs is the honest fix there)` : '';
  check('peaks', 'WARN', `the limiter took up to ${mastered.limiterDb} dB off the loudest peaks: ${pk.join(', ') || 'peaks spread across the mix'}. Lower that voice's gain, one hit's g in the scene's cues(), or every hit of a kind with cues.<kind>: { type, gain } in music.mjs${sheet ? '' : ' (no cue sheet: these are music voices)'}${quiet}`, { peaks: pk });
}
check('loudness', Math.abs(fin.I - LUFS) <= 0.5 ? 'PASS' : 'WARN', `integrated ${fin.I} LUFS (target ${LUFS}), LRA ${fin.LRA} LU`, { I: fin.I, LRA: fin.LRA });
check('truepeak', fin.TP <= TP + 0.05 ? 'PASS' : 'FAIL', `true peak ${fin.TP} dBTP (ceiling ${TP})`, { TP: fin.TP });
check('linear', mastered.pass2.normalization_type === 'linear' ? 'PASS' : 'WARN', `loudnorm pass 2 ran ${mastered.pass2.normalization_type} (linear keeps dynamics and timing exact)`);

// ------------------------------------------------------------------ QC on the delivered file
const W = readWav(OUT);
const mono = new Float32Array(W.n); for (let i = 0; i < W.n; i++) mono[i] = 0.5 * (W.L[i] + W.R[i]);
const off = win ? win[0] : 0;
{ // mono fold (dual mono keeps the BS.1770 channel sum comparable) and the phone band
  const mI = ebur(OUT, 'pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1').I, pI = ebur(OUT, 'highpass=f=200:poles=2,highpass=f=200:poles=2').I;
  const drop = +(fin.I - mI).toFixed(2), pdrop = +(fin.I - pI).toFixed(2);
  check('mono', drop <= 3 ? 'PASS' : 'WARN', `mono fold loses ${drop} LU (> 3 LU = phase cancellation: keep lows mono, Haas only on mids)`, { mono_I: mI, drop });
  const pv = res.probe ? phoneByVoice(res.probe, win) : null;
  if (pv) report.phoneByVoice = pv;
  const top = pv?.rows.filter(r => r.dropWithout != null && r.dropWithout < pv.estimate - 0.5).slice(0, 2) ?? [];
  check('phone', pdrop <= 6 ? 'PASS' : 'WARN', `200 Hz high-passed (phone speaker) loses ${pdrop} LU${pdrop > 6 ? ` (want <= 6): the mix leans on sub${top.length ? `; mostly ${top.map(r => r.voice).join(' and ')}` : ''}` : ''}`, { phone_I: pI, drop: pdrop });
  if (pdrop > 6 && pv) {
    const say = s => console.warn(`  ${''.padEnd(4)} ${''.padEnd(9)} ${s}`);
    say(`by voice (dry, before reverb and master; ungated estimate ${pv.estimate} LU): full-band share -> phone-band share · the drop without it`);
    for (const r of pv.rows.filter(r => r.full >= 2 || r.phone >= 5).slice(0, 6)) say(`  ${r.voice.padEnd(14)} ${String(r.full).padStart(3)} % -> ${String(r.phone).padStart(3)} %  · ${r.dropWithout == null ? '  -' : r.dropWithout.toFixed(1).padStart(4)} LU without it  (this voice alone loses ${r.lossDb} LU)`);
    for (const r of top) say(`fix ${r.voice}: ${phoneFix(r, info)}`);
    say('music-synthesis.md §10 has the verified recipe; re-run and read this table again');
  }
}
{ // silences: intended gaps vs holes
  // measured on the written file (slice-relative), reported in REEL time: iteration 3 read "9.00-9.60" for a designed
  // gap at 13.8-14.4 s as an accidental silence (clip/new-1)
  const sil = silences(OUT, W.n / SR);
  const fx = info.fx.filter(f => ['gap', 'tapestop'].includes(f.kind)).map(f => [f.t - off, f.t - off + f.dur]);
  const ends = info.ending.mode === 'button' ? [[info.ending.silentFrom - off - 0.05, Infinity]] : [];
  const near = (a, b) => [...fx, ...ends].some(([x, y]) => a < y + 0.06 && b > x - 0.06);
  const atReel = s => [+(s[0] + off).toFixed(3), +(s[1] + off).toFixed(3)], fmtS = l => l.map(([a, b]) => `${a.toFixed(2)}-${b.toFixed(2)}`).join(', ');
  const holes = sil.filter(([a, b]) => !near(a, b) && !(a < 0.05) && !(b > W.n / SR - 0.05 && info.ending.mode !== 'loop')).map(atReel);
  report.silences = sil.map(atReel);
  check('silence', holes.length ? 'WARN' : 'PASS', `${sil.length} silence(s) below -45 dB for >= 0.1 s${sil.length ? ': ' + fmtS(report.silences.slice(0, 8)) : ''}${win ? ' (reel time)' : ''}${holes.length ? `; NOT explained by a gap, tapestop or the ending: ${fmtS(holes)}` : ''}`);
  const gaps = info.fx.filter(f => f.kind === 'gap').map(f => ({ t: f.t - off, d: f.dur })).filter(g => g.t >= 0 && g.t + g.d < W.n / SR - 0.15);
  if (gaps.length) {   // the gap before a hit must read clearly darker than the hit
    const depth = gaps.map(g => { const a = rms(mono, g.t + 0.004, g.t + g.d - 0.004), b = rms(mono, g.t + g.d, g.t + g.d + 0.15); return +(20 * Math.log10((b + 1e-9) / (a + 1e-9))).toFixed(1); });
    check('gaps', Math.min(...depth) >= 15 ? 'PASS' : 'WARN', `${gaps.length} gap(s) at ${gaps.map(g => (g.t + off).toFixed(2)).join(', ')} s: the 150 ms after each is ${depth.join(', ')} dB above the gap (want >= 15)`, { depth, at: gaps.map(g => +(g.t + off).toFixed(3)) });
  }
}
{ // onset vs cue alignment for hero cues
  const heroes = (sheet?.cues || []).filter(c => (c.s ?? 0) >= 0.45 && c.t - off > 0.03 && c.t - off < W.n / SR - 0.03);
  if (heroes.length) {
    const hop = 120, E = new Float64Array(Math.ceil(W.n / hop));   // 2.5 ms frames of a pre-emphasised signal (transients, not bass ripple)
    { let pv = 0; for (let i = 0; i < W.n; i++) { const y = mono[i] - 0.97 * pv; pv = mono[i]; E[(i / hop) | 0] += y * y; } }
    const rows = heroes.map(c => {
      const f0 = Math.round((c.t - off) * SR / hop); let best = -Infinity, bf = f0;
      for (let f = f0 - 12; f <= f0 + 12; f++) {   // +-30 ms: 5 ms now vs the 20 ms before
        if (f < 8 || f + 1 >= E.length) continue; let h = 0; for (let k = 1; k <= 8; k++) h += E[f - k];
        const v = 10 * Math.log10((E[f] + E[f + 1] + 1e-12) / (h / 4 + 1e-12)); if (v > best) { best = v; bf = f; }
      }
      return { t: c.t, kind: c.kind, offMs: +((bf * hop / SR - (c.t - off)) * 1000).toFixed(1), riseDb: +best.toFixed(1) };
    });
    const ok = rows.filter(r => r.riseDb >= 3), offs = ok.map(r => Math.abs(r.offMs)).sort((a, b) => a - b);
    report.onsets = rows;
    if (offs.length) check('onsets', offs[offs.length - 1] <= 10 ? 'PASS' : 'WARN', `${ok.length}/${rows.length} hero cues (s >= .45) have an onset within +-30 ms: median ${offs[offs.length >> 1]} ms, max ${offs[offs.length - 1]} ms (want <= 10)${rows.length > ok.length ? `; masked: ${rows.filter(r => r.riseDb < 3).map(r => `${r.kind}@${r.t.toFixed(2)}`).join(' ')}` : ''}`);
    else check('onsets', 'WARN', `none of ${rows.length} hero cues (s >= .45) has an audible onset (>= 3 dB rise) within +-30 ms: voice them`);
  }
}
{ // ending: on the full score, and on a slice that holds it (the final hit for a button, the reel's end for a ring):
  // compose applies the ending to the whole mix, so the slice already has it; iteration 3 (lock/new-2) heard a button
  // gate cut a sonic logo in a slice whose report said "ending not checked"
  const e = info.ending, n = W.n, thr = Math.pow(10, -60 / 20);
  const holdsEnd = !win || (e.mode === 'button' ? e.finalAt >= win[0] - 1e-6 && e.finalAt < win[1] - 1e-6 : e.mode === 'ring' ? win[1] >= DUR - 1e-3 : false);
  if (!holdsEnd) check('ending', 'INFO', `window ${win[0].toFixed(2)}-${win[1].toFixed(2)} s: ${e.mode === 'button' ? `the final hit (${e.finalAt.toFixed(2)} s) is outside it` : e.mode === 'ring' ? 'the reel\'s end is outside it' : 'a loop seam is checked on the full score'}; ending not checked`);
  else if (e.mode === 'button') {
    let last = -1; for (let i = n - 1; i >= 0; i--) if (Math.abs(W.L[i]) > thr || Math.abs(W.R[i]) > thr) { last = i; break; }
    const lastT = (last + 1) / SR + off, hitEnd = e.finalAt + e.gate, after = lastT - hitEnd, endT = off + n / SR;
    const cut = e.cutCount ? `; the gate silences ${e.cutCount} later note${e.cutCount > 1 ? 's' : ''}: ${e.cut.map(c => `${c.src ? c.src + ' ' : ''}${c.voice} @ ${c.t.toFixed(2)}`).join(', ')}${e.cutCount > e.cut.length ? ' ...' : ''} (a sonic logo after the final hit: set audio.buttonAt after it, or make its last note the final cue)` : '';
    check('ending', after > 0.020 ? 'FAIL' : cut ? 'WARN' : 'PASS', `button${win ? ' (in this slice)' : ''}: final hit ${e.finalAt.toFixed(3)} s (${e.source}), gate ${(e.gate * 1000).toFixed(0)} ms; silent (< -60 dBFS) from ${lastT.toFixed(3)} s = ${(after * 1000).toFixed(1)} ms after the gate (want <= 20); ${(endT - lastT).toFixed(2)} s of silence to the ${win ? 'slice\'s ' : ''}end${cut}${e.cutGrid ? `; ${e.cutGrid} grid note${e.cutGrid > 1 ? 's' : ''} past it` : ''}`, { lastSound: +lastT.toFixed(4), afterMs: +(after * 1000).toFixed(1), cut: e.cut ?? [] });
  } else if (e.mode === 'ring') {
    const lastAbs = Math.max(Math.abs(W.L[n - 1]), Math.abs(W.R[n - 1])), tail = rms(mono, n / SR - 0.05, n / SR), body = rms(mono, n / SR - 2.5, n / SR - 0.5);
    check('ending', lastAbs < thr * 10 ? 'PASS' : 'WARN', `ring: rings out into a ${e.fade.toFixed(2)} s fade at the very end; last 50 ms ${(20 * Math.log10(tail / (body + 1e-12) + 1e-12)).toFixed(1)} dB vs the 2 s before; last sample ${lastAbs.toExponential(1)}`);
  } else if (e.mode === 'loop') {
    // the seam must look like any other bar line: largest sample step within 1 ms before / 3 ms after, seam vs the others
    const stepAt = (t) => { let mx = 0; for (let i = Math.round((t - 0.001) * SR); i < Math.round((t + 0.003) * SR); i++) { const a = mono[((i - 1) % n + n) % n], b = mono[((i % n) + n) % n]; mx = Math.max(mx, Math.abs(b - a)); } return mx; };
    const nb = Math.round(DUR / info.barSec), lines = []; for (let k = 1; k < nb; k++) lines.push(stepAt(k * info.barSec));
    const med = lines.length ? lines.slice().sort((a, b) => a - b)[lines.length >> 1] : 0, mx = lines.length ? Math.max(...lines) : 0, seam = stepAt(0);
    const head = rms(mono, 0, 0.25), tailR = rms(mono, n / SR - 0.25, n / SR);
    const whole = Math.abs(DUR / info.barSec - Math.round(DUR / info.barSec)) < 0.01;
    check('ending', seam <= Math.max(mx, 1.5 * med) && whole ? 'PASS' : 'WARN', `loop: seam step ${seam.toExponential(2)} vs other bar lines median ${med.toExponential(2)} / max ${mx.toExponential(2)}; last 0.25 s ${(20 * Math.log10(tailR + 1e-12)).toFixed(1)} dBFS -> first 0.25 s ${(20 * Math.log10(head + 1e-12)).toFixed(1)} dBFS; ${(DUR / info.barSec).toFixed(2)} bars${whole ? '' : ' (NOT whole bars)'}; ${e.tail} s tail folded into the head`, { seam, barLineMedian: med, barLineMax: mx });
  }
}
{ // per-section loudness map (momentary, power-averaged)
  const M = mastered.momentary || [];
  const rows = info.sections.map(s => {
    const a = s.at - off, b = s.at - off + s.dur, xs = M.filter(m => m.t > a + 0.4 && m.t <= b + 0.01).map(m => m.M).filter(v => Number.isFinite(v) && v > -70);
    const avg = xs.length ? 10 * Math.log10(xs.reduce((acc, v) => acc + Math.pow(10, v / 10), 0) / xs.length) : null;
    return { name: s.name, energy: s.energy, M: avg == null ? null : +avg.toFixed(1), max: xs.length ? +Math.max(...xs).toFixed(1) : null };
  }).filter(r => r.M != null);
  report.sectionLoudness = rows;
  if (rows.length) log(`  map       ${rows.map(r => `${r.name}[e${r.energy}] ${r.M}`).join(' | ')}  (momentary LUFS per section: the arc should be visible)`);
}

// ------------------------------------------------------------------ outputs
if (!has('--no-mp3')) ff(['-v', 'error', '-y', '-i', OUT, '-c:a', 'libmp3lame', '-b:a', '320k', OUT.replace(/\.wav$/i, '.mp3')]);
if (!win) fs.writeFileSync(path.join(ROOT, 'build', 'music.json'), JSON.stringify({ bpm: info.bpm, meter: info.meter, beatsPerBar: info.beatsPerBar, stepsPerBar: info.stepsPerBar, duration: DUR,
  key: info.key, scale: info.scale, ending: info.ending, sections: info.sections, chords: info.chords, hits: info.hits,
  voices: info.voices, motif: info.motif, signals: res.signals }));   // ReelMakeEasy: voices + motif, read by the API as data
if (!has('--no-png')) {
  const png = path.join(ROOT, 'qc', win || OUT !== path.resolve(ROOT, 'audio/score.wav') ? `audio-${path.basename(OUT, '.wav')}.png` : 'audio.png');
  const Wd = 1600, len = W.n / SR, xs = info.sections.map(s => Math.round((s.at - off) / len * Wd)).filter(x => x > 0 && x < Wd);
  const hx = (sheet?.cues || []).filter(c => (c.s ?? 0) >= 0.45).map(c => Math.round((c.t - off) / len * Wd)).filter(x => x >= 0 && x < Wd);
  const marks = [...xs.map(x => `drawbox=x=${x}:y=0:w=2:h=ih:color=yellow@0.7:t=fill`), ...hx.map(x => `drawbox=x=${x}:y=0:w=3:h=18:color=red@0.9:t=fill`)].join(',');
  const fc = `[0:a]showwavespic=s=${Wd}x220:split_channels=1:colors=0x9fd3ff|0xffc27a[w];[0:a]showspectrumpic=s=${Wd}x420:legend=0:scale=log:fscale=log:color=intensity[s];[w][s]vstack${marks ? ',' + marks : ''}[o]`;
  const r = spawnSync(FF, ['-v', 'error', '-y', '-i', OUT, '-filter_complex', fc, '-map', '[o]', '-frames:v', '1', png], { encoding: 'utf8' });
  if (r.status === 0) { log(`  png       ${rel(png)} (waveform L/R over a log-frequency spectrogram; yellow = sections, red = hero cues)`); report.png = rel(png); }
  else console.warn('  (waveform image failed: ' + (r.stderr || '').trim().split('\n').pop() + ')');
}
if (has('--stems')) {
  // the whole score -> audio/stems/<bus>.wav; a slice or another --out -> audio/stems/<out name>-<bus>.wav, same slice
  const g = Math.pow(10, mastered.gainDb / 20); fs.mkdirSync(path.join(ROOT, 'audio', 'stems'), { recursive: true });
  const plain = !win && OUT === path.resolve(ROOT, 'audio/score.wav'), pre = plain ? '' : `${path.basename(OUT, '.wav')}-`;
  const made = [];
  for (const b of ['beat', 'music', 'sfx']) {
    const st = compose(spec, sheet, { ending: endingOpt, audio: audioCfg, onlyBus: b });
    const sl = win ? cut(st.L, win) : st.L, sr = win ? cut(st.R, win) : st.R;
    let pk = 0; for (let i = 0; i < sl.length; i++) { sl[i] *= g; sr[i] *= g; pk = Math.max(pk, Math.abs(sl[i]), Math.abs(sr[i])); }
    if (pk === 0) continue;
    writeWavF32(path.join(ROOT, 'audio', 'stems', `${pre}${b}.wav`), sl, sr); made.push(b);
  }
  log(`  stems     audio/stems/${pre}{${made.join(',')}}.wav${win ? ` (slice ${win[0].toFixed(2)}-${win[1].toFixed(2)} s)` : ''} (float, the master's gain, unlimited: they sum to the mix within the limiter's reduction)`);
}
fs.writeFileSync(path.join(ROOT, 'qc', win ? 'score-report-window.json' : 'score-report.json'), JSON.stringify(report, null, 1));
if (has('--mux') && !win) {
  // the newest render wins (a final after a draft, or a draft after a final). Drafts are range-stamped since iteration 4
  // (render.cjs: exports/draft-<a>-<b>.mp4, or draft-<config>-<a>-<b>.mp4); exports/silent-draft.mp4 is the old name
  const exp = path.join(ROOT, 'exports');
  const silent = [path.join(exp, 'silent.mp4'), ...(fs.existsSync(exp) ? fs.readdirSync(exp).filter(f => /^draft-.+\.mp4$/i.test(f) || f === 'silent-draft.mp4').map(f => path.join(exp, f)) : [])]
    .filter(p => fs.existsSync(p)).sort((x, y) => fs.statSync(y).mtimeMs - fs.statSync(x).mtimeMs)[0];
  if (!silent) console.warn('  --mux: no exports/silent.mp4 or exports/draft-*.mp4 yet (ReelMakeEasy renders the reel with its own music: --mux is not needed)');
  else {
    // a range render (render.cjs video a-b) starts at a: cut the score from the same second so picture and sound stay in
    // sync. A draft's start is in its name; qc/render.json (the last render) gives a final range's start.
    let start = 0;
    const named = path.basename(silent).match(/^draft-(?:.*-)?(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\.mp4$/i);
    if (named) start = +named[1];
    else try { const rj = JSON.parse(fs.readFileSync(path.join(ROOT, 'qc', 'render.json'), 'utf8')); if (path.resolve(ROOT, rj.out || '') === path.resolve(silent) && rj.start > 0) start = rj.start; } catch { }
    const mo = path.resolve(ROOT, opt('--mux') ?? (named ? `exports/reel-${path.basename(silent)}` : /draft/i.test(path.basename(silent)) ? 'exports/reel-draft.mp4' : 'exports/reel.mp4'));
    ff(['-v', 'error', '-y', '-i', silent, ...(start ? ['-ss', start.toFixed(6)] : []), '-i', OUT, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-shortest', '-movflags', '+faststart', mo]);
    log(`  mux       ${rel(silent)} + ${rel(OUT)}${start ? ` from ${start.toFixed(3)} s (range render)` : ''} -> ${rel(mo)}`);
  }
}
if (has('--json')) console.log(JSON.stringify(report, null, 1));
log(`\n${rel(OUT)} written${win ? ` (window ${win[0].toFixed(2)}-${win[1].toFixed(2)} s)` : ' + build/music.json'}; report qc/${win ? 'score-report-window' : 'score-report'}.json.` +
  ` Checked by measurement, not by ear: ask the user to listen to the hook, the drop and the ending.`);
process.exit(report.checks.some(c => c.status === 'FAIL') ? 3 : 0);

// ================================================================== helpers
/** The hit a section is built around, for --around: its first boom / final / lock with s >= .45 (a hero cue, as the
 *  onset check defines it), else its strongest impact (largest s, earliest on a tie), else null (use the start).
 *  Bus-effect and picture-only kinds (gap, transition ...) are never the hit; a cue on the end line belongs to the next section. */
function heroCue(cues, a, b) {
  const inside = cues.filter(c => c.t >= a - 1e-6 && c.t < b - 1e-6 && !BUS_KINDS.has(c.kind) && !PICTURE_ONLY.has(c.kind));
  const h = inside.find(c => ['boom', 'final', 'lock'].includes(c.kind) && (c.s ?? 0) >= 0.45);
  if (h) return { ...h, hero: true };
  const s = inside.filter(c => (c.s ?? 0) > 0).sort((x, y) => (y.s - x.s) || (x.t - y.t))[0];
  return s ? { ...s, hero: false } : null;
}
/** Limiter culprits: runs of samples above the limiter's ceiling (split where they pause for 0.1 s), the 3 it took most
 *  off, each with the dry voices (compose's probe: voices, 'cues', 'inst:<name>') loudest within 5 ms of its peak, as
 *  shares of their summed peak level. Times are from the start of L/R (the slice); the caller adds the slice start. */
function limiterPeaks(L, R, ceil, probe, w) {
  const ev = []; let cur = null;
  for (let i = 0; i < L.length; i++) {
    const a = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (a <= ceil) continue;
    if (cur && i - cur.last <= 0.1 * SR) { cur.last = i; if (a > cur.a) { cur.a = a; cur.i = i; } } else { cur = { i, a, last: i }; ev.push(cur); }
  }
  const o = w ? Math.round(w[0] * SR) : 0, h = Math.round(0.005 * SR);
  return ev.sort((x, y) => y.a - x.a).slice(0, 3).map(e => {
    const rows = probe ? Object.entries(probe).map(([g, arr]) => { let m = 0; for (let k = e.i - h; k <= e.i + h; k++) { const v = Math.abs(arr[k + o] ?? 0); if (v > m) m = v; } return { voice: g, m }; }).filter(r => r.m > 0) : [];
    const tot = rows.reduce((s, r) => s + r.m, 0) || 1;
    return { t: e.i / SR, db: 20 * Math.log10(e.a / ceil), top: rows.sort((a, b) => b.m - a.m).slice(0, 2).map(r => ({ voice: r.voice, share: Math.round(100 * r.m / tot) })) };
  });
}
/** Phone band by voice: K-weighted energy of each group's dry signal with and without the QC's 2 x 200 Hz high-pass.
 *  Ungated and before reverb/duck/master, so the total differs a little from the ebur128 figure; the ranking is the
 *  point. dropWithout = the mix's drop with that group removed (smallest first = the main cause). */
function phoneByVoice(probe, w) {
  const groups = Object.entries(probe).map(([g, a]) => [g, w ? a.slice(Math.round(w[0] * SR), Math.round(w[1] * SR)) : a]).filter(([, a]) => a.length);
  if (!groups.length) return null;
  const n = groups[0][1].length;
  // ITU-R BS.1770 K-weighting at 48 kHz (shelf + RLB high-pass), the curve ebur128 applies
  const kw = x => { const y = new Float32Array(x.length); let a1 = 0, a2 = 0, b1 = 0, b2 = 0, c1 = 0, c2 = 0, d1 = 0, d2 = 0;
    for (let i = 0; i < x.length; i++) {
      const s = 1.53512485958697 * x[i] - 2.69169618940638 * a1 + 1.19839281085285 * a2 + 1.69065929318241 * b1 - 0.73248077421585 * b2; a2 = a1; a1 = x[i]; b2 = b1; b1 = s;
      const r = s - 2 * c1 + c2 + 1.99004745483398 * d1 - 0.99007225036621 * d2; c2 = c1; c1 = s; d2 = d1; d1 = r; y[i] = r;
    } return y; };
  const hp = x => { const f1 = biquad('hp', 200, 0.707), f2 = biquad('hp', 200, 0.707), y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = f2(f1(x[i])); return y; };
  const E = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return s; };
  const Ed = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return s; };
  const mix = new Float32Array(n); for (const [, a] of groups) for (let i = 0; i < n; i++) mix[i] += a[i];
  const Km = kw(mix), Pm = kw(hp(mix)), eK = E(Km), eP = E(Pm);
  if (!(eK > 0) || !(eP > 0)) return null;
  const db = (x, y) => (x > 0 && y > 0 ? +(10 * Math.log10(x / y)).toFixed(1) : null);
  const rows = groups.map(([g, a]) => {
    const Ka = kw(a), Pa = kw(hp(a)), k = E(Ka), p = E(Pa);
    return { voice: g, full: Math.round(100 * k / eK), phone: Math.round(100 * p / eP), lossDb: db(k, p), dropWithout: groups.length > 1 ? db(Ed(Km, Ka), Ed(Pm, Pa)) : null };
  }).filter(r => r.full > 0 || r.phone > 0);
  rows.sort((x, y) => (x.dropWithout ?? 99) - (y.dropWithout ?? 99));
  return { estimate: db(eK, eP), rows };
}
function phoneFix(r, info) {
  const g = r.voice, through = 'play the low hit through a voice that has harmonics (voices: { low: { inst: \'e808\', bus: \'sfx\', harmonics: -8 } }, then api.play(\'low\', {...}) in the cue function)';
  if (g === 'cues') return `the cue sounds (the default boom, lock and final are sub drops): ${through}, or give them a mid body`;
  if (g.startsWith('inst:')) return `the ${g.slice(5)} sounds from step() or section fx: ${through}`;
  const v = info.voices?.[g], poly = v && ['pad', 'drone', 'supersaw', 'stab', 'choir', 'organ'].includes(v.inst);
  const trim = r.full >= 50 ? `; it holds ${r.full} % of the full band, so take 2 dB off it too (gain ${+((v?.gain ?? 1) * 0.8).toFixed(2)})` : '';
  if (poly) return `a chord voice: lift its register or high-pass it (fx: [{ type: 'hp', f: 120 }]); harmonics are for single-note lines${trim}`;
  // the music-synthesis.md §10 recipe, in the order it was measured: -8 first, then -6, then gain instead of more
  if (v?.harmonics == null) return `harmonics: -8 on it (-6 if the WARN stays)${trim}`;
  if (v.harmonics < -5) return `its harmonics are at ${v.harmonics} dB: try ${v.harmonics + 2}${trim}`;
  return `its harmonics are already at ${v.harmonics} dB (louder turns to grit): take 2-3 dB of gain off it (gain ${+((v.gain ?? 1) * 0.75).toFixed(2)}) or shorten its decay`;
}
function ff(args) { const r = spawnSync(FF, args, { encoding: 'utf8', maxBuffer: 1 << 28 }); if (r.error) die(`ffmpeg not runnable (${r.error.message}); set FFMPEG=<path>`); if (r.status !== 0) die(`ffmpeg failed: ${args.join(' ')}\n${(r.stderr || '').slice(-1500)}`); return r.stderr || ''; }
function lastJson(txt) { const i = txt.lastIndexOf('{'), j = txt.lastIndexOf('}'); if (i < 0 || j < i) return null; try { return JSON.parse(txt.slice(i, j + 1)); } catch { return null; } }
function measureLoud(file) {
  const j = lastJson(ff(['-hide_banner', '-nostats', '-i', file, '-af', `loudnorm=I=${LUFS}:TP=${TP}:LRA=11:print_format=json`, '-f', 'null', '-']));
  if (!j) die(`loudnorm measurement of ${file} printed no JSON`);
  const o = {}; for (const [k, v] of Object.entries(j)) o[k] = Number.isFinite(+v) ? +v : v; return o;
}
function loudnorm2(src, out, m) {
  const af = `loudnorm=I=${LUFS}:TP=${TP}:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=json`;
  const j = lastJson(ff(['-hide_banner', '-nostats', '-y', '-i', src, '-af', af, '-ar', String(SR), '-c:a', 'pcm_s16le', out]));
  return j ? { normalization_type: j.normalization_type, output_i: +j.output_i, output_tp: +j.output_tp, target_offset: +j.target_offset } : { normalization_type: 'unknown' };
}
function ebur(file, pre = null) {
  const txt = ff(['-hide_banner', '-nostats', ...(pre ? [] : ['-v', 'verbose']), '-i', file, '-af', `${pre ? pre + ',' : ''}ebur128=peak=true${pre ? '' : ':framelog=verbose'}`, '-f', 'null', '-']);   // frame lines need -v verbose (ffmpeg 7+)
  const sum = txt.slice(txt.lastIndexOf('Summary:'));
  const num = re => { const m = re.exec(sum); return m ? +m[1] : NaN; };
  const momentary = [];
  if (!pre) for (const m of txt.matchAll(/t:\s*([\d.]+)\s+TARGET:\S+\s+LUFS\s+M:\s*(-?[\d.]+|-?inf|nan)\s+S:\s*(-?[\d.]+|-?inf|nan)/g)) momentary.push({ t: +m[1], M: +m[2], S: +m[3] });
  return { I: num(/I:\s*(-?[\d.]+)\s*LUFS/), LRA: num(/LRA:\s*(-?[\d.]+)\s*LU/), TP: num(/Peak:\s*(-?[\d.]+|-inf)\s*dBFS/), momentary: pre ? undefined : momentary };
}
function silences(file, dur) {
  const txt = ff(['-hide_banner', '-nostats', '-i', file, '-af', 'silencedetect=n=-45dB:d=0.1', '-f', 'null', '-']);
  const out = []; let a = null;
  for (const m of txt.matchAll(/silence_(start|end):\s*(-?[\d.]+)/g)) { if (m[1] === 'start') a = +m[2]; else if (a != null) { out.push([a, +m[2]]); a = null; } }
  if (a != null) out.push([a, dur]);
  return out;
}
function rms(x, a, b) { const i0 = Math.max(0, Math.round(a * SR)), i1 = Math.min(x.length, Math.round(b * SR)); let s = 0; for (let i = i0; i < i1; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, i1 - i0)); }
function limitLoop(l, r, ceil) {   // circular look-ahead: limit two cycles, keep the second
  const n = l.length, L2 = new Float32Array(2 * n), R2 = new Float32Array(2 * n);
  L2.set(l); L2.set(l, n); R2.set(r); R2.set(r, n);
  const hits = limit(L2, R2, ceil, { look: 0.004, release: 0.08 });
  l.set(L2.subarray(n)); r.set(R2.subarray(n)); return hits;
}
function writeTmp(l, r) { writeWavF32(TMP_WAV, l, r); return TMP_WAV; }
function writeWavF32(file, l, r) {
  const n = l.length, buf = Buffer.alloc(44 + n * 8);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 8, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(3, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 8, 28); buf.writeUInt16LE(8, 32); buf.writeUInt16LE(32, 34); buf.write('data', 36); buf.writeUInt32LE(n * 8, 40);
  for (let i = 0; i < n; i++) { buf.writeFloatLE(l[i], 44 + i * 8); buf.writeFloatLE(r[i], 48 + i * 8); }
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buf);
}
function readWav(file) {
  const b = fs.readFileSync(file); let p = 12, fmt = null, data = null;
  while (p + 8 <= b.length) { const id = b.toString('ascii', p, p + 4), sz = b.readUInt32LE(p + 4); if (id === 'fmt ') fmt = { tag: b.readUInt16LE(p + 8), ch: b.readUInt16LE(p + 10), sr: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) }; if (id === 'data') { data = [p + 8, Math.min(sz, b.length - p - 8)]; break; } p += 8 + sz + (sz & 1); }
  if (!fmt || !data) die(`cannot parse ${file}`);
  const bps = fmt.bits / 8, n = Math.floor(data[1] / (bps * fmt.ch)), L = new Float32Array(n), R = new Float32Array(n);
  const rd = o => (fmt.tag === 3 ? b.readFloatLE(o) : fmt.bits === 16 ? b.readInt16LE(o) / 32768 : fmt.bits === 24 ? b.readIntLE(o, 3) / 8388608 : b.readInt32LE(o) / 2147483648);
  for (let i = 0; i < n; i++) { const o = data[0] + i * bps * fmt.ch; L[i] = rd(o); R[i] = fmt.ch > 1 ? rd(o + bps) : L[i]; }
  return { L, R, n, sr: fmt.sr };
}
