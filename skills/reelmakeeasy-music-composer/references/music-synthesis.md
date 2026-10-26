# Music synthesis: write, voice, mix and measure `music.mjs`

Read this after the plan's `## Music` lines are filled from `music-direction.md` (concept, recipe, tempo, harmony,
motif, arc). This file is the *how*: the format, grids and feel, instruments, mix, endings, measurement, and the four
stable recipes as complete files. **`node tools/score.mjs --help` and `--list` (run in `reel/music/`) are authoritative** (they describe
`tools/audio/*.mjs`); where this file disagrees, follow the tool and say so.

Evidence: (physics) acoustics or arithmetic · (practice) production convention · [checked] measured with this composer
by its authors · signal = vendor or single source · `[n]` = sources at the end. Nothing here is a default.

Contents: 1 Loop · 2 Top-level fields · 3 Voices · 4 Grid strings · 5 Feel: swing, humanize, feel changes · 6 Harmony,
motif, sections, step · 7 Instruments and materials · 8 An optional cue sheet · 9 Transition and tension recipes ·
10 Mix · 11 Endings · 12 Measurement QC · 13 Slices and auditions · 14 Score → picture · 15 Arrangement moves that
keep it stable · 16 Four stable recipes · Sources

## 1. Loop and commands

Everything runs in `reel/music/`, in your shell. `tools/` is ReelMakeEasy's copy of the composer: never edit it.

```bash
node tools/score.mjs --no-cues --harmony   # the harmony check alone, in seconds: run it first, until it prints ok
node tools/score.mjs --no-cues    # music.mjs -> audio/score.wav + .mp3, build/music.json, qc/audio.png, qc/score-report.json
node tools/score.mjs --list       # 80 instruments + parameters, voice inserts, voice keys, cue kinds, scales
node tools/score.mjs --no-cues --around <section|bar> --out audio/sketch.wav   # about 10 s (whole bars) around a section's start
node tools/score.mjs --no-cues --from-bar <n> [--seconds s | --bars n] | --section <name> [--bars n] | --window a-b
node tools/score.mjs --no-cues --seed <n>    # same structure, new humanize / arpeggio / texture rolls
node tools/score.mjs --no-cues --solo v1,v2 | --mute v1,v2   # audition at the full mix's gain, never over the score
```
- Exit 0 = written (WARN = advice) · 1 = refused/error · 3 = a QC FAIL (harmony, true peak or ending). It refuses without
  `music.mjs` or with `sections: []`: there is no fallback music.
- `reel.config.mjs` holds `bpm` (yours), meter `'4/4'`, the reel's `duration`, and `audio: { ending: 'ring', lufs: -14,
  tp: -1 }`. Read `config.bpm` and `config.meter` in `music.mjs` (`export default ({ config }) => ({ bpm: config.bpm,
  ... })`). Without a cue sheet the score's length is the sum of its sections: make them the reel's bars
  (`music-direction.md` §3).
- Loop: edit → `--harmony` until ok → score → read the console `harmony` and `map` lines, `qc/score-report.json`,
  `qc/audio.png` → fix. A full render
  rewrites `build/music.json` and `qc/score-report.json`; a slice (§13) reports to `qc/score-report-window.json` and
  leaves `build/music.json` alone [checked]. `motion_music` takes only a full render newer than `music.mjs`.
- Deterministic: same `music.mjs` + seed → identical mix. No `Math.random`/`Date`; use `seed`, `ctx.rng`, `api.rand`.
- **Bar numbers.** Inside `music.mjs` every bar key (`notes[].bar`, `fx` bar, section `fx` bar, `motif` bar) is an
  offset counted **from 0**: bar 0 is the reel's (or the section's) first bar, and `beat` 0 is its downbeat. The
  command line (`--around B`, `--from-bar B`) counts bars from 1. A note that lands past the end is dropped with a WARN
  naming it (the usual off-by-one) [checked].

## 2. Top-level fields

`export default { ... }`, or `export default (ctx) => ({ ... })` with `ctx = { sheet (a cue sheet or null), T, lib,
config }`; optional `export function step(ctx)` (§6). Accepted spellings: `voices{inst}` or `instruments{type}` ·
`scale` or `mode` · `stepsPerBar` or `steps`.

| Field | Value | Notes |
|---|---|---|
| `bpm`, `meter` | from `config` | quarter-note bpm, 4/4 for a reel. A tempo map is refused. |
| `stepsPerBar` | cells per bar | default 16 in 4/4; a voice/pattern may set its own `steps` |
| `key`, `scale` | `'F#'` + mode name or semitone array | required once anything is pitched |
| `seed` | integer | every random choice |
| `voices` · `swing` · `humanize` | `{ <name>: { inst, ... } }` · per voice + `default` | §3, §5 |
| `grids` · `byEnergy` · `grid` | named sets `{ <voice>: pattern }` · energy → set · fallback set | §4 |
| `progression` · `chordBars` · `progressionMode` | chord tokens · bars per chord (1) · `'section'` (restart per section) or `'global'` | §6 |
| `motif` | `{ degrees, rhythm, voice, steps?, octave?, gate?, legato? }` | §6; its notes are the picture's melody accents |
| `sections` | array | §6; must add up to the reel's bars |
| `notes` | `[{ voice, bar, beat \| at, deg \| tone \| note \| notes \| chord, dur \| beats \| steps, vel }]` | one-off events; `bar` and `beat` count from 0 (§1), `at` is seconds |
| `fx` | `[{ kind, at \| bar (+beat), dur \| bars \| beats, bus, ... }]` | global bus effects, objects only (§9) |
| `mix` | `{ duck, reverb, reverbBus, delay, hp, monoBelow, width, drive, tape, gapBefore }` | §10 |
| `start` · `ringFade` | seconds | `start` offsets the music; `ringFade` the ring-out's fade (§11) |

## 3. Voices

`<voice>: { inst, ...composer keys, ...instrument parameters }`. Name voices for what they are (`kick`, `bass`,
`lead`): ReelMakeEasy reads each voice's instrument and name: a voice is a kick when its instrument is `kick` or its name
  says kick, a snare when its instrument is `snare`/`clap` or its name says snare or clap. Composer keys:
- **Level, routing:** `gain` · `pan` −1..1 · `send` (reverb) · `dsend` (delay) · `bus` `beat|music|sfx` (default by
  instrument kind: drums → beat, tonal/texture → music, fx/foley → sfx).
- **Register:** `octave` (default 2 for bass instruments, 3 drums, 4 others) · `low` (lowest MIDI of the chord-tone
  register) · `transpose` · chords: `voicing` `'close'` (voice-led from the previous chord) | `'spread'` | `'shell'`,
  `center`, `size`. Drum-kind voices (`wood membrane tom conga logdrum`) take a fixed `note`, a `notes` cycle or grid
  chord tokens; they never arpeggiate on their own.
- **Time:** `steps` (own resolution) · `swing` · `human {ms, vel}` · `offset` ms (+ = late) · `gate` 0..1 of a cell
  (0.9) · `velMap {X, x, o}` · `vel` (scale) · `velHold` (for `'hold'`). `mono: true` or `choke: '<group>'` cuts the
  previous note (closed and open hat in one group).
- **Energy:** `minEnergy` / `maxEnergy` play the voice only in sections inside the range (layers,
  `music-direction.md` §6).
- **Inserts:** `fx: [{ type, ... }]`, a per-voice chain before the sends (§7).
- **Phones:** `harmonics: -8` (or `true`, or `{ db, input, hp, lp }`) adds the harmonics 2-12 of a monophonic low
  voice above 200 Hz, so a phone speaker plays the line; the recipe and its measurements are in §10.
- **Glides:** `porta: true` starts each note of the voice from its previous note; `porta: 'legato'` only when the
  previous note is still sounding (a rest resets it). It works on `acid` `e808` `logdrum` `pulse`, over their own
  `glide` time; on any other instrument it WARNs and does nothing. One glide by hand: the note's `from` (MIDI) or
  `slide` (semitones from the note) [checked].
- **Automation:** any *instrument parameter*, `pan` and `send` may be a function `c => value`, called per note with
  `{ t, energy, section, bar (in section), step, absStep, vel, chord, T }`. `gain`, `vel` and `dsend` must be numbers:
  a function there silenced the mix (gain, vel) or the delay (dsend) [checked]. Move levels with grid velocities,
  per-section pattern `gain`, or `step()`.

## 4. Grid strings

One character per cell; `|` and spaces are ignored (show beats with them).
- `X` accent 1.0 · `x` 0.75 · `o` ghost 0.35 · `.` or `-` rest · `_` tie (extends the previous hit).
  Pitched: `R` root · `3 5 7 9` · `O` octave · `A` approach (a semitone under the next chord's bass: a non-chord tone, so the harmony check fails it) · `C` whole chord;
  they hit at 0.8, so accent them with the voice's `velMap` (`{ R: 1, ... }`). An `X` (velocity ≥ 0.9) on a voice the
  motif plays on is a strong melody accent in the reel.
- Macros: `E(k,n[,rot][,X|x|o])` Euclid · `'a+b'` concatenate · `'a*3'` repeat.
- **Length is the cycle:** `stepsPerBar` cells loop per bar, 2× = a 2-bar phrase, any other length drifts across the
  bar line (polymeter) and realigns after lcm(length, bar) cells.
- **Pattern forms:** `'<grid>'` · `'hold'` (one note or chord per chord change, held: drones, pads, textures) ·
  `{ grid, steps, notes, swing, vel, gain, pan, phase, rotate, octave, gate, human, velMap, minEnergy, maxEnergy,
  ...instrument params }`.
- **`notes`:** degrees cycled per hit (0 = tonic, 7 = octave in a 7-note mode, −1 below, `'3.5'` a quarter-tone) ·
  names `'Eb4'` · chord-tone indices `'c0' 'c1'…` (notes arrays only) · arpeggios `'up' 'down' 'updown' 'random'`
  over chord tones (`arpOctaves`, `notesReset: 'bar'`). A pitched voice with nothing set plays `'up'`.
- **Cell ruler** (4/4, 16 cells, 0-based like `ctx.step`): beats 0 4 8 12 · 8th off-beats 2 6 10 14 · odd cells are
  the "e"/"a" 16ths. Four-on-the-floor 0 4 8 12 · backbeat 4 12 · half-time backbeat 8.
- **Euclid** (Toussaint [3]): `E(3,8)` = `x..x..x.` (tresillo, 3+3+2) · `E(5,8)` = `x.x.xx.x` · `E(5,16)` =
  `x...x..x..x..x..`. `rot` rotates left: `E(3,8,1)` = `..x..x.x`.
- **Polymeter:** `phase: 'global'` counts an odd-length grid from the reel start, not the section, so a 3-cell figure
  keeps drifting across sections [checked]. `rotate: n` shifts the start (left, like `rot`).
- **Triplets:** a 6/12/24-cell grid on a 16-cell bar is a polymeter, not triplets (the composer warns). Give the voice
  or pattern `steps: 12` (8th triplets in 4/4) or `24`.
- **Start from a recipe's grids** (§16) and fit them to the reel: the section lengths, a 4th-bar fill, which voices
  play in which section. A grid from a known record is copying (`music-direction.md` §11).

## 5. Feel: swing, humanize, feel changes

- **Linn swing** s: the 2nd cell of each pair is late by (2s−1)·cell [1]. 0.5 straight · ~0.54 loosens · ~0.58 light ·
  ~0.62 boom-bap/jazz · 0.66 triplet feel · 0.75 dotted. Precedence: pattern `swing` > `section.swing[voice]` > voice
  `swing` > top `swing[voice]` > `swing.default` > 0.5. Applies only when a beat holds an even number of cells
  (ignored on 12-cell triplet grids). Decide per voice; a straight kick under swung hats is a choice.
- **Humanize** `{ ms, vel }`: seeded jitter, ±3–8 ms and ±10 % velocity (practice). Laid-back feel = fixed `offset`:
  snare +15–30 ms, kick −5–10 ms (practice, after Linn on Dilla [2]). Keep jitter ≤ 5 ms on kicks, snares and the
  motif: the picture lands on them.
- **Feel changes at one bpm:**
  - half-time: a grid set with the backbeat on cell 8 and a thinner kick, for that section;
  - double-time hats: the hat pattern gets `steps: 32`;
  - triplet fill: a shadow voice with `steps: 12` and an all-rest grid sits in the set; the fill set gives it the
    triplet figure and sets the straight voice to `null`. Fills index at the voice's own resolution, so `steps` inside
    the fill pattern alone does nothing [checked];
  - accelerando without a tempo map: subdivision 8ths → 16ths → 32nds across sections (`steps`), cut density with it;
    one exact landing by hit-point solving (`music-direction.md` §3).
```js
// mechanism only: a triplet fill at one bpm (fill in your own instruments and cells)
voices: { perc: { inst: '<instrument>' }, perc3: { inst: '<instrument>', steps: 12 } },
grids:  { body: { perc: '<16 cells>', perc3: '............' }, trip: { perc3: '<12 cells>', perc: null } },
sections: [{ name: '<name>', bars: 4, grid: 'body', fill: { grid: 'trip', last: true } }],
```

## 6. Harmony, motif, sections, step

- **Chord tokens**, relative to the current mode: Roman `'I' 'vi7' 'bVII' 'IVmaj7' 'Vsus4' 'IVadd9'`, secondary
  `'V/V'`, pedal `'IV>I'` (IV over the I bass: IV holds the tonic) · diatonic stacks `1 '4^7' '2^9'` · names `'Fmaj9'
  'C/E'` · MIDI arrays literal · `'-'` no chord. A slash or pedal bass must be a tone of its chord (`'V>I'`, `'F/Eb'`
  FAIL the harmony check). Per section: `prog`, `chordBars`; a section `key`, `mode` or `transpose` that changes the
  notes FAILs it too (the relative major/minor is the one move allowed). Chord-token bass lines follow the bass of
  slash and pedal chords. Every chord change is a chord event in the reel. The rules: `music-direction.md` §8.
- **Motif** `{ degrees, rhythm (grid), voice }`, stated by `section.motif` (`true` | `'<transform>'` | `{ voice,
  transform, bar, beat, every, times }`) or by `play: { <voice>: 'motif:<transform>' }`. Transforms `retro invert aug
  dim shift:<n>`, chained with `+` (re-check the beats after a transform: the harmony check reads every note). Derive
  the degrees (`music-direction.md` §9); cryptogram helper:
  `import { cryptogram } from './tools/audio/theory.mjs'` → `cryptogram('<word>', 7)` = degrees [checked]. Every note
  of every statement is a melody accent in the reel (`melody(0.8)`): state it where elements should pop.
- **Section keys:** `name` · length by `bars` | `beats` | `dur` | `at` (+length) | `until: 'end'` · `energy` 0–4 ·
  `grid` (set name or inline set) · `add` (merge a set) · `play` (`{voice: pattern | 'motif…'}`, or an array = only
  these) · `only` · `mute` · `fill` `{ grid, every: n | bars: [..] | last: true }` (several in an array; a voice set to
  `null` in a fill set is silent in those bars [checked]) · `swing` · `motif` · `fx` (§9) · the harmony keys above.
  Section names and energies become the reel's sections: name them for what they are (`intro`, `build`, `drop`,
  `break`, `outro`).
- **`step(ctx)`**, once per grid cell over the music sections: `{ t, absStep, step, bar, beat, section, sectionBar,
  energy, chord {root, ints, symbol, notes}, key, scale, T, stepSec, barSec, stepsPerBar, rng, lib, play(voice, {...}),
  inst(name, {...}), cuesNear(dt) }`; `rng` is seeded, `lib` = euclid parseNote nameOf mtof degree parseChord
  expandGrid. Use it for probabilistic events and phrase-aware lines.
- **Sparse worlds** (ambient pads): `'hold'` pads per chord change, sparse chord-tone events from `step()` with `rng`,
  whole bars left near-silent on purpose. The reel still needs a grid: keep a quiet pulse (a rim,
  a tick) so the picture has kicks or snares to follow, or plan the picture on the motif.

## 7. Instruments (80, sample-free): which are harmonic

All oscillators, noise, envelopes and filters; `--list` has every parameter. You can't judge timbre: acoustic idioms
come out as toy/FM/lo-fi versions (`music-direction.md` §1). A voice in front that imitates a voice or a real source
means asking the user's ear after the render (`music-direction.md` §1).

| Family | Instruments | Recipe notes |
|---|---|---|
| Kick, sub | `kick e808 sub` | kick = sine f0 → f1, τ 20–40 ms, decay 0.15–0.4 s, click (practice); `e808` `slide`/`from` glides over `glide`; `drive` is grit, not a phone fix: the voice key `harmonics` is (§10). A `kick` voice is the reel's kick track |
| Snare, hats | `snare clap hat ride shaker rim cowbell chipnoise` | metallic hat = six inharmonic squares [5]; `snare gated` [13]; `chipnoise` LFSR long/short [12]. `snare` and `clap` voices are the reel's snare track |
| Tuned, hand perc | `tom conga taiko logdrum membrane wood body brush` | tune to scale degrees; `logdrum` = pitched bass, pitch drop + 1:1 FM knock [11]; `body` chest/thigh/snap/stomp; `brush` swirl/tap |
| Bass | `sawBass reese acid wobble upright triangle` | `wobble div` locks the LFO to beats; `acid` `accent` and `from` (slide over `glide`, 60 ms); all need harmonics (§10) |
| Keys, plucks | `pluck ks epiano piano organ fm bell pulse blip sine arpSaw` | `ks` Karplus-Strong, feedback .990–.998, `strum` [6]; `epiano` 1:1 body + tine FM [7]; `piano` (`felt`) is the weakest emulation; `pulse` duty 12.5/25/50 % + `arp` fake chords [12]. `fm` only with an integer `ratio` (1, 2, 3, 4) for anything pitched; the `bell` on any ratio (its partials read as a bell: the owner approved the 1.4 bell) |
| Modal (inharmonic) | `bar glass modal membrane ceramic wood` | free-free bar 1:2.756:5.404:8.933 · circular membrane 1:1.594:2.136… (physics) · glass 1:2.32:4.25:6.63: partials off the harmonic series, so they fight the chord. Unpitched percussion and ticks under 0.15 s only (`decay` ≤ ~0.06 s); the tuned bar `bar tuned: true` (1:4:10) is the one harmonic modal voice |
| Object gestures | `rattle scrape` | unpitched foley only: a drop settling in bounces, a click train |
| Pads, voices | `pad supersaw stab brass vox choir drone braam` | supersaw 7 saws 0/±6/±12/±20 cents; `vox`/`choir` formants, male /a/ 730·1090·2440 Hz, ×1.15–1.2 female/child [4]; `braam`: once at most, with a reason [10] |
| Textures | `vinyl hiss wind` (+ `mix.tape`) | crackle and air under a lo-fi bed; keep it low |
| Transition fx | `boom riser whoosh sweep downlifter shepard doppler aperture snip shutter crackle bloop` | §9; Shepard weights by sin² so wraps are silent [8] |
| Foley | `ceramic paper tapepull squish boing degauss channel shing bubble gel fabric stamp shatter click` | `degauss hum` 50 Hz (60 in the Americas) |

**Harmonic and inharmonic** (the harmony check's timbre rule, `music-direction.md` §8). Harmonic, for every pitched
voice (lead, hook, chords, bass): `epiano pluck supersaw pad stab sine pulse organ arpSaw blip triangle sub sawBass
reese acid wobble e808 logdrum upright`, `fm` with an integer `ratio`, `bell` on any ratio, `bar` with `tuned: true`.
Inharmonic, for unpitched percussion and ticks shorter than 0.15 s only: `glass modal bar membrane ceramic wood`, object
shapes (`shape: 'plate' | 'ring' | 'tube'`), `fm` with a non-integer ratio (2.32). The check reads each note's
sounding length (its gate, or its decay to about −20 dB for a struck voice) and FAILs an inharmonic one held longer.
UI sounds: a `tick`, `click`, `key` or `blip`, short, or a chord tone on a harmonic voice.

**`pulse` glides (the chip slide).** A note's `from` (MIDI) or `slide` (semitones from the note, negative = from
below) glides to the note over `glide` (0.06 s), linear in pitch; `stepHz: 60` quantises the slide to one pitch update
per video frame (0 = smooth). A whole line of slides is `porta: true` on the voice (§3).

**Voice inserts** `fx: [...]`, in order, whole voice: `crush {bits 6, hold 4 | rate Hz, mix}` · `drive {g 2, mix}` ·
`lp|hp|bp|notch {f, q}` · `peak|lowshelf|highshelf {f, q, gain dB}` · `autofilter {filter, lo, hi, div per beat | rate,
q, phase}` · `tremolo {div | rate, depth, stereo}` · `gain {db}`. For a time window use bus fx (§9).

## 8. An optional cue sheet

Most reels need none: put one-off hits in `notes`, section `fx` and `fx` objects, and the reel's sound effects in
Remotion (`<Sfx>`). A cue sheet adds the composer's designed hit sounds at exact seconds, and centres `--around` on
the hits. Write `build/cues.json` by hand from the plan, then run `node tools/score.mjs` **without** `--no-cues`:
```json
{ "bpm": 136, "meter": "4/4", "beatsPerBar": 4, "duration": 60,
  "cues": [ { "kind": "boom", "t": 14.118, "s": 1 }, { "kind": "riser", "t": 38.824, "d": 1.76 } ] }
```
- `bpm` and `beatsPerBar` must equal `music.mjs`'s (an error otherwise); `duration` is the reel's length (the score
  is that long, whatever the sections add up to: keep them equal). Times are seconds: bar n starts at `n × 240 / bpm`.
- `kind` is one of `node tools/score.mjs --list`'s cue kinds; `s` (0-1) is how strong (≥ .45 = a hero cue the
  `onsets` check measures), `g` scales the sound, `d` is a length. Re-voice every kind you use in music.mjs (the
  defaults are generic):
```js
cues: {
  <kind>: false,                                   // silent
  <kind>: '<voice>',                               // that voice, pitched by the cue's note degree, else the chord root
  <kind>: { type: '<instrument>', ...params },     // gain x the cue's g; dur defaults to the cue's d
  <kind>: (c, api) => { api.play('<voice>', { chord: true, dur: <s> }); },
}
```
`api`: `inst(name, params)` · `play(voice, {deg | tone | note | chord, dur, vel, t})` · `chordAt(t)` · `cueNote(deg)` ·
`duration` · `T` · `rand` (seeded per cue). Cue sounds go to the `sfx` bus and are not events in the reel: put a kick,
snare or motif note on the same beat when the picture should hit it too. Keep the reel's `<Sfx>` off those beats.

## 9. Transition and tension recipes

Which device serves the arc: `music-direction.md` §6. How to build each here:

| Device | Build it with | Note |
|---|---|---|
| Pre-drop gap | section `gap16`/`gap8`/`gap4` (last 1/N note, all buses) · an `fx` object `{ kind: 'gap', bar, beat, beats }` · `mix.gapBefore {kinds, steps, keep}` with a cue sheet | QC `gaps`: 150 ms after ≥ 15 dB above the gap; a note whose onset falls in the gap is a WARN naming it |
| Reverse swell | section `'reverse'` (2 beats into the section end) | never on the same hit as a gap: the swell fills it [checked] |
| Riser, downlifter | section `'riser'` (last bar), `'downlifter'` (first bar) | |
| Shepard | section `'shepard'` (whole section) | endless zoom or tunnel |
| Filter build, focus | section `'lpclose'` (18 kHz → 400 Hz across it), `'lpopen'`, `'hpopen'` | |
| Tape stop | section `'tapestop'` (last beat, silent to the section end) | rate `1 − (t/T)^p`, T 0.3–0.8 s (practice) |
| Stutter, glitch | section `'stutter'` (last beat, 1/32 slices), `'bitcrush'` (whole section) | |
| Freeze | section `'granular'` | |
| Accelerating roll | a denser fill grid, or a voice with `steps: 32` in the last bar; velocity rising `o x X` | cut density D2 → D4 within WCAG |
| Breakdown · half-time switch | `mute`, `only`, `maxEnergy` · a section grid with the backbeat on cell 8 | |
| Fake drop | a section with one soft element, the real drop a bar later | once at most |
| Suspension → resolve | `'Vsus4'` then `'V'` through the build, the tonic on the hit | the sus resolves to its triad |
| Displacement | `rotate` a figure's pattern one cell further each section, or move the motif's `beat` per statement | snaps home on the drop |
| Ducked hit | `mix.duck.by` takes voices (`['kick']`) | §10 |

Rules: ≤ 1 whoosh per 4 bars, never two identical in a row · ≤ 1 ear-candy device per phrase · silence is the
strongest transition sound · not a riser into every section.

## 10. Mix

Flow: voices (inserts) → buses `beat music sfx` → per-bus delay + reverb (`reverbBus` scales the wet per bus) → duck →
bus fx → master sum → reverse swells → master chain: high-pass `hp` 25 Hz, side high-pass below `monoBelow` 120 Hz
(mono lows), `width`, `drive` (tanh), `tape {wow %, flutter %}` → ending → two-pass loudnorm to −14 LUFS, −1 dBTP.
- **Duck** `{ by, depth .4, beats .6 (or sec), targets: ['music'] }`, gain `1 − depth·(1 − t/len)²`; depth .3–.5
  subtle (≈ 3–6 dB), .6–.8 audible pump (practice). Needed when kick and bass both hold long on one downbeat.
- **Space:** reverb `{size .83, damp .32, wet .85}` · delay `{beats .75 (dotted 8th), fb .35, lp 3500, wet, spread}` ·
  per-instrument default sends in `--list`. Throw the delay on a phrase's last note only (`dsend` on one pattern).
- **Register** (practice): bass roots E1–E2, no 3rds below ~C3, pads 200 Hz–2 kHz so lead and UI-like voices own
  2–6 kHz; a busy hat and a busy foley layer fight.
- **Phones:** speakers roll off below 150–200 Hz, so a sub, kick or 808 line vanishes on them while the loudness
  normaliser still pays for it; the ear rebuilds a missing fundamental from its harmonic series, so the fix is
  harmonics *above* 200 Hz (QC `phone`: ≤ 6 LU lost after 2 × 200 Hz high-pass). The recipe [checked]:
  1. **Read the per-voice table** printed under the WARN (also `phoneByVoice` in `qc/score-report.json`): each
     voice's share of the full band and of the phone band, and the mix's drop without it, smallest first. The ranking
     is the point. The top row is usually the kick-like voice.
  2. **`harmonics: -8` on that voice** (a voice key, §3): harmonics 2-12 of its fundamental, in phase so the voice's
     peak barely grows, kept between 200 Hz and 3.5 kHz, in mono, 8 dB under the voice's RMS; the sub itself is
     untouched. Measured drops went from 7-8 LU to 5-6 LU (PASS).
  3. **Still above 6:** `-6`, and 2 dB less gain on that voice when it holds ≥ 50 % of the full band. The WARN's `fix`
     line prints the next step for the voice it names.
  4. **A `peaks` WARN after it** (limiter > 6 dB): take 2-3 dB of gain off the same voice.
  - Monophonic low voices only (`kick e808 sub logdrum acid sawBass reese`, a bass line): on a chord or two low notes
    at once it intermodulates into grit. A chord voice gets a higher register or an `hp` insert instead.
  - **What did not work:** `drive` 4-5 on the kick-like voice, with or without more `click`, or a `drive` insert:
    tanh harmonics peak with the bass's own peak, and every dB of peak is a dB the limiter takes back. Leave `drive`
    for grit.
- **Stereo:** Haas and wide detuned pairs on mids only, lows mono → QC `mono`.
- **Hit level:** a limiter depth > 6 dB (`peaks` WARN) means the hits sit far above the bed. The WARN names up to three
  peaks it took most off, in seconds, each with the voice loudest within 5 ms of it: lower that voice's `gain`, or raise
  the bed. When the WARN also says the target lifts the mix by more than 12 dB, most of the reel is quiet (a
  silence-led arc): a lower `audio.lufs` in `reel.config.mjs` would be honest, but ReelMakeEasy evens the reel's
  loudness when it renders, so prefer a louder bed.

## 11. Endings (`audio.ending: 'ring'` in `reel.config.mjs`)

- `ring`: everything rings out; cosine fade of `ringFade` (0.5 s; set `ringFade` in music.mjs) at the very end. Put
  the final chord ≥ 1.5 s before the end so it actually rings: a 1-2 bar final section with a held chord, a sub and
  one bell. QC: the last sample silent. The reel's end card lands on that chord.
- Design the ending: a plain cadence into the tonic (`music-direction.md` §8), not a fade-out.
- `button` (a dead stop on the final hit) and `loop` exist in the composer (`--ending`), but the reel fades its music
  on the last half bar, so keep `ring` unless the plan has a reason.

## 12. Measurement QC: `qc/score-report.json`

| Check | Measures | Pass | If not |
|---|---|---|---|
| `harmony` | every pitched note, cue sounds included (`tools/audio/harmony.mjs`): the mode, one key (and a key wherever a pitch is held), unstable chords (#11, b9, #9, altered, augmented, diminished), slash basses, chords outside the key (borrowed ones included; a minor piece's Picardy last chord excepted), notes off the semitone, notes outside the key, non-chord tones (every note is a chord tone or its plain 9th/11th/6th: no passing or neighbour tones at all), the bass (and any note below C3) off root and fifth, sustained m2/M7/tritone clashes between voices, inharmonic voices (any instrument kind but the bell) holding a pitch | none of these (FAIL, exit 3) | each line names the time, voice, note and chord: fix them (`music-direction.md` §8); `--harmony` re-checks in seconds |
| `loudness` · `truepeak` | integrated LUFS, LRA · dBTP of the delivered file | ±0.5 LU · ≤ ceiling (FAIL, exit 3) | lower hit gains, re-render |
| `linear` | loudnorm pass-2 mode | linear | `master.pass1.input_lra` > 11 LU makes loudnorm ride the gain (dynamic): lift the quietest section or shorten long quiet stretches; a WARN you may keep when the arc needs its quiet break (say so) |
| `peaks` | limiter depth | ≤ 6 dB | hits too far above the bed (§10) |
| `mono` | LU lost folding to mono | ≤ 3 LU | phase: no Haas or detune in the lows; raise `monoBelow` |
| `phone` | LU lost after 2 × 200 Hz high-pass; on a WARN, a per-voice table and a `fix` line | ≤ 6 LU | the §10 recipe on the voice the table names |
| `silence` | silencedetect −45 dB ≥ 0.1 s [9] | all explained by gap / tapestop / ending | an accidental hole: a voiceless section, a `mute`, a short grid |
| `gaps` | the 150 ms after each gap vs the gap | ≥ 15 dB | no swell on the same hit; nothing playing into it |
| `onsets` | hero cues of a cue sheet (s ≥ .45): onset within ±30 ms | max ≤ 10 ms | give the hit a transient; no swell, slow attack or humanize on it |
| `ending` | the ring-out | last sample silent | a held final chord, ≥ 1.5 s before the end |

- **A FAIL refuses the score**: `motion_music` will not take it. Fix and run again. For `harmony`, the console prints up
  to four lines per kind and the ten worst clashes; `harmony` in `qc/score-report.json` has the counts and the lists.
  Common fixes: a non-chord melody note → change it to a chord tone (moving it off the beat or shortening it does not
  help: there are no passing tones) · a motif note that does not fit a chord → state the motif over a chord that holds
  all its notes (a section motif's `bar`), or change the note · a clash with a held pad → change the melody note or the
  chord · a slash chord → its plain triad · a borrowed chord → the key's own chord (bVI in dorian → IIImaj7: Dmaj7 →
  Amaj7 in F# dorian) · a 7th chord with a tone outside the key → the key's own 7th chord on that degree · an
  inharmonic hook → `epiano`, `pluck`, `supersaw`, `bell` or an integer-ratio `fm` · a mode or key change → one mode
  for every section. Never fix a clash by dropping to plain triads: richness comes from 7ths and 9ths in the key.
- **The check is arithmetic, not an ear.** It proves the notes keep the rules; it cannot hear a mix that masks the
  melody, a chord voiced too low or a lead that is too loud. Say so.
- **Loudness map:** the console `map` line and `sectionLoudness` (momentary LUFS per section) must show the planned
  arc: louder with energy, the breakdown clearly down, the drop up. Sections of different energy within ~1 LU of each
  other make no audible step (practice heuristic).
- **Reading `qc/audio.png`** (open it: waveform L/R over a log spectrogram; yellow = sections; practice): drums =
  vertical lines · bass = bright band under ~120 Hz · pads = horizontal bands · risers = rising diagonals · gaps = dark
  columns · clipping = broadband smear at hits · a constant wide band below 60 Hz outside hits = mud.
- **What you say:** "checked by measurement (harmony, loudness, true peak, mono, phone band, gaps, ending), not by ear", the
  WARNs you kept and why, and ask the user to listen to the hook, the drop and the ending in the render.

## 13. Slices and auditions

- `--around <section>` (a music section's name) or `--around <bar>` (from 1): about 10 s in whole bars at the reel's
  tempo (N = round(10 / bar length), at least 2; `--seconds S` or `--bars N` to change it), the window starting on a bar
  line N/2 bars before the section's start, so the run-up and the landing are both in it. `--from-bar B`, `--section
  <name>`, `--bars N`, `--window a-b` are the other slices. A slice's times are reel times.
- A slice writes `audio/sketch.wav` unless `--out` names another file (never `audio/score.wav`), reports to
  `qc/score-report-window.json` and never writes `build/music.json`: always finish with the full score.
- `--solo v1,v2` / `--mute v1,v2` render only (or all but) those voices at the full mix's master gain to
  `audio/audition-*.wav`: a way to measure one voice (its phone-band loss, its peaks). Neither is a score.

## 14. Score → picture

`build/music.json` (full renders only) holds `bpm`, `duration`, `sections [{name, at, dur, bars, energy}]`, `chords
[{t, section, symbol, notes}]`, `hits {voice: [[t, vel]]}`, `voices {voice: {inst, bus}}`, `motif [[t, vel, voice]]`
(every note of every motif statement) and control `signals`. `motion_music` reads it as data and writes the reel's
grid and events (`public/reel.json`, `music-map.md`): beats every 60/bpm s from 0, a downbeat every bar, kicks from
the `kick` voices (an `e808`/`sub` when there is none), snares from the `snare` and `clap` voices, the melody from the
motif notes (strength 1) and the other notes of the motif's voices (1 when accented, else 0.6), chord changes, and
your sections (energy 4 reads as 3). The scenes then use `kicks()`, `snares()`, `melody(0.8)` and the sections (the
motion-reel skill). So:
- name sections for what they are; one world per section;
- state the motif where elements should pop, and keep its voice clean of other busy figures;
- keep the kick on the beats the background should pulse to (a half-time section halves the pulse).

## 15. Arrangement moves that keep it stable

Variety comes from the arrangement, never from new harmony or an odd sound: 1 change something every 2 bars; never
loop 1 bar > 4 times unchanged (2-bar grids, `fill.every`) · 2 a fill on the last beat of every 4-bar phrase, a bigger
one every 8 (`fill: [{every: 4, …}, {bars: […]}]`) · 3 subtract: mute a layer for a bar (fill with `null`) · 4 add
one layer per section (assembly) · 5 swing decided per voice · 6 seeded humanize, small on kick, snare and motif · 7
automate filters, sends and decays per section (per-note functions, section patterns, `fx` strings) · 8 ≤ 1 ear candy
(reverse swell, delay throw, tape stop) per phrase · 9 a counter-line in the last third on chord tones (`minEnergy` or
late sections only) · 10 shaped dynamics: crescendos through `o x X`, not flat 1.0 · 11 the motif doubled an octave up
at the peak · 12 move sounds in stereo with the picture's objects (`pan` functions) · 13 tune the kick: `f1` near the
root · 14 a designed ending (§11).

## 16. Four stable recipes (complete files to start from)

Each passes the harmony check and was measured with this composer (not heard). Richness comes from 7ths and 9ths,
swing, off-beat stabs and layering, never from a note outside the chord: A and D show it; B and C are triad-based, so
voice them with 7ths and 9ths in the key. Start from the one nearest the reel
(`music-direction.md` §10) and adapt it: `bpm` (then the bars), the key (move every chord with it; the Roman numerals
of B and C follow the key by themselves), the sections and their lengths, the sounds, the motif (re-check its beats
with `--harmony`). `reel/music/reel.config.mjs` is ReelMakeEasy's; only `bpm` is yours:
```js
export default { title: '...', bpm: 136, meter: '4/4', duration: 60, fps: 30, audio: { ending: 'ring', lufs: -14, tp: -1 } };
```

### A. Garage loop: F# dorian, 136 BPM, 60 s (34 bars)

The owner's liked garage track with B9, the 1.4 bell and the F# 6/9 Picardy ending, and one change: its borrowed Dmaj7
(bVI) is Amaj7 (IIImaj7). Two motif statements moved onto chords that hold all their notes (the keys' motif off the
G#m7 bar, the break's bell motif from the Amaj7 bar). Measured: harmony ok (554 pitched notes, every chord in F#
dorian), −13.9 LUFS, −1.0 dBTP, mono 0 LU, phone 5.7 LU, both gaps ≥ 32 dB, ring ending PASS; the `map` line −15.9 |
−13.8 | −13.7 | −24.0 | −12.4 | −13.5 | −17.2 | −32.5 LUFS shows the two-drop arc. It kept two WARNs: a shaker onset
inside each pre-drop gap (move the shaker or `keep` the bus) and `linear` (the quiet break pushed loudnorm to dynamic
mode). The true peak sits on the ceiling: after any change, a true-peak FAIL of −0.9 dBTP is fixed by another `seed`
(it moves the humanize, not the notes) or a lower hit gain.
```js
// RECIPE A: a UK garage / 2-step loop for a 60 s showreel. F# dorian (cool, hopeful minor), 136 BPM, 34 bars.
// The owner's liked garage track, with one change: its borrowed Dmaj7 (bVI, from the parallel minor) is Amaj7 (IIImaj7).
// Harmony, every tone in F# dorian: i9 - IV9 - IIImaj7 - ii7 (F#m9 B9 Amaj7 G#m7), IIImaj7 - V (Amaj7 E) into the drops
// and the outro, and the F# major 6/9 Picardy chord to end (the one chord allowed outside the key: a minor piece's last).
// The 7ths and 9ths are the richness: a plain-triad version sounds like an exercise.
// Arc two-drop: drop at bar 9 (~24 %), breakdown, bigger drop at bar 23 (~65 %), short resolve, ring ending.
// Motif (speech rhythm of the product's name): C# A B G# F#, stated only over chords that hold every one of its notes
// as a chord tone or a plain 9th/11th/6th (the keys on the F#m9 and Amaj7 bars, the break's bell from the Amaj7 bar).
// The hook is a soft FM bell (ratio 1.4: the bell is exempt from the inharmonic rule) doubled by a supersaw.
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
    { name: 'build', bars: 4, energy: 2, grid: 'build', motif: { voice: 'keys', every: 2 }, fx: ['riser', 'gap16'] },
    { name: 'dropA', bars: 8, energy: 3, grid: 'dropA', fill: { grid: 'dropAfill', every: 4 }, motif: { voice: 'lead', every: 2 } },
    { name: 'break', bars: 4, energy: 1, grid: 'brk', prog: ['F#m9', 'B9', 'Amaj7', 'C#m7'], motif: { voice: 'bell', transform: 'aug', every: 4, bar: 2 }, fx: ['downlifter'] },
    { name: 'lift', bars: 2, energy: 2, grid: 'lift', prog: ['Amaj7', 'E'], fx: ['riser', 'gap8'] },
    { name: 'dropB', bars: 8, energy: 4, grid: 'dropB', fill: { grid: 'dropBfill', every: 4 }, prog: ['F#m9', 'B9', 'Amaj7', 'G#m7'], motif: { voice: 'lead', every: 2 }, play: { lead8: 'motif' } },
    { name: 'outro', bars: 2, energy: 2, grid: 'outro', prog: ['Amaj7', 'E'], motif: { voice: 'bell', transform: 'retro' } },
    { name: 'final', bars: 2, energy: 1, grid: 'final', prog: [[42, 49, 54, 58, 61, 63, 68]], chordBars: 2 },   // F# 6/9 as MIDI: F# C# F# A# C# D# G#
  ],

  ringFade: 0.6,

  mix: {
    duck: { by: ['kick'], depth: 0.45, beats: 0.5, targets: ['music'] },
    reverb: { size: 0.82, damp: 0.35, wet: 0.8 },
    delay: { beats: 0.75, fb: 0.32, lp: 3200, wet: 0.8, spread: 1 },
    monoBelow: 120,
    width: 1.1,
  },
});
```

### B. Minor launch: A minor, 128 BPM, 30 s (16 bars)

Measured: harmony ok (272 pitched notes), −13.7 LUFS, −1.0 dBTP, phone 5.5 LU, ring ending PASS; `map` −15.5 | −12.6 |
−13.1 | −24.5 | −24.4 LUFS; WARN `linear` kept (the quiet break and end).
```js
// RECIPE: a minor-key launch track. A natural minor, i-VI-III-VII (Am F C G), 128 BPM, four-on-the-floor.
// 30 s = round(30 x 128 / 240) = 16 bars. Arc: intro 2 · build 2 · drop 8 · break 2 · end 2 (rings on Am).
// Stable by construction: triads, the bass on roots and octaves, the motif on chord tones and plain 9ths/6ths on every
// step. For more richness, voice the chords with their 7ths and 9ths in the key (Am9 Fmaj7 Cmaj7 G6).
export default ({ config }) => ({
  bpm: config.bpm, meter: config.meter, key: 'A', mode: 'aeolian', seed: 128,
  swing: { hat: 0.54, default: 0.5 },
  voices: {
    kick: { inst: 'kick', f0: 150, f1: 45, decay: 0.3, click: 0.3, gain: 0.72, harmonics: -6 },
    clap: { inst: 'clap', tone: 1500, gain: 0.42, send: 0.25 },
    hat: { inst: 'hat', mode: 'metal', tone: 8400, gain: 0.26, pan: 0.2, choke: 'hh' },
    ohat: { inst: 'hat', mode: 'metal', open: true, decay: 0.08, gain: 0.2, pan: 0.25, choke: 'hh' },
    bass: { inst: 'sawBass', cut: 700, decay: 0.2, octave: 1, gain: 0.5, harmonics: -8 },
    sub: { inst: 'sub', cut: 200, octave: 1, gain: 0.45 },
    pad: { inst: 'pad', cut: 1200, attack: 0.3, release: 0.8, detune: 8, chorus: 0.5, gain: 0.42, send: 0.45, voicing: 'close', center: 62, size: 3 },
    pluck: { inst: 'pluck', decay: 0.14, index: 1.1, gain: 0.42, send: 0.3, dsend: 0.2, octave: 5, pan: -0.2 },
    lead: { inst: 'supersaw', cut: 5000, hp: 250, attack: 0.008, release: 0.15, spread: 0.8, gain: 0.32, send: 0.3, dsend: 0.2, octave: 5 },
  },
  progression: ['i', 'VI', 'III', 'VII'],
  chordBars: 1,
  // E D C A C: each a chord tone or a plain 9th/11th/6th of the chord under it (A is the 6th over C)
  motif: { degrees: [4, 3, 2, 0, 2], rhythm: 'X..x..x.X...x...', voice: 'pluck' },
  grids: {
    intro: { pad: { hold: true, gain: 1.3 }, hat: '..x...x...x...x.', pluck: { grid: 'x.x.x.x.x.x.x.x.', notes: 'up', gain: 1.2 }, sub: { grid: 'R_______________', gate: 0.9, gain: 0.6 } },
    build: { pad: 'hold', kick: { grid: 'x...x...x...x...', gain: 0.7 }, hat: '..x...x...x...x.', bass: { grid: '..R...R...R...R.', gate: 0.7, gain: 0.8 } },
    drop: {
      pad: 'hold', kick: 'X...X...X...X...', clap: '....X.......X...', hat: 'x.x.x.x.x.x.x.xo', ohat: '..x...x...x...x.',
      bass: { grid: '..R.O.R...R.O.R.', gate: 0.7 }, sub: { grid: 'R...R...R...R...', gate: 0.9 },
      pluck: { grid: 'x.x.x.x.x.x.x.x.', notes: 'up', arpOctaves: 2, gain: 0.6 },
    },
    dropfill: { kick: 'X...X...X.......', clap: '....X.......X.XX' },
    brk: { pad: { hold: true, gain: 1.8 }, pluck: { grid: 'x.x.x.x.x.x.x.x.', notes: 'up', gain: 1 }, sub: { grid: 'R...............', gate: 0.95 }, hat: '..x...x...x...x.' },
    end: { pad: { hold: true, gain: 1.8 }, sub: { grid: 'R...............', gate: 1 }, pluck: { grid: 'x...............', notes: [7] } },
  },
  sections: [
    { name: 'intro', bars: 2, energy: 1, grid: 'intro', motif: { voice: 'pluck', every: 2 } },
    { name: 'build', bars: 2, energy: 2, grid: 'build', motif: { voice: 'pluck', every: 2 }, fx: ['gap16'] },
    { name: 'drop', bars: 8, energy: 3, grid: 'drop', fill: { grid: 'dropfill', every: 4 }, motif: { voice: 'lead', every: 2 } },
    { name: 'break', bars: 2, energy: 1, grid: 'brk', motif: { voice: 'pluck', transform: 'aug' } },
    { name: 'end', bars: 2, energy: 1, grid: 'end', prog: ['i'], chordBars: 2 },
  ],
  ringFade: 0.6,
  mix: {
    duck: { by: ['kick'], depth: 0.45, beats: 0.5, targets: ['music'] },
    reverb: { size: 0.8, damp: 0.35, wet: 0.75 }, delay: { beats: 0.75, fb: 0.3, lp: 3200, wet: 0.7, spread: 1 },
    monoBelow: 120, width: 1.1,
  },
});
```

### C. Bright pop-house: C major, 124 BPM, 30 s (16 bars, 30.97 s)

Measured: harmony ok (307 pitched notes), −14.0 LUFS, −1.0 dBTP, phone 4.4 LU, ring ending PASS; `map` −15.7 | −12.7 |
−14.5 | −29.4 LUFS; WARN `linear` kept (the quiet end).
```js
// RECIPE: a bright major pop-house track. C major, I-V-vi-IV (C G Am F), 124 BPM, four-on-the-floor.
// 30 s = round(30 x 124 / 240) = 16 bars (30.97 s). Arc: intro 2 · verse 4 · drop 8 · end 2 (V-I, rings on C).
export default ({ config }) => ({
  bpm: config.bpm, meter: config.meter, key: 'C', mode: 'ionian', seed: 124,
  swing: { hat: 0.55, shaker: 0.55, default: 0.5 },
  voices: {
    kick: { inst: 'kick', f0: 145, f1: 48, decay: 0.28, click: 0.3, gain: 0.72, harmonics: -6 },
    clap: { inst: 'clap', tone: 1600, gain: 0.4, send: 0.25 },
    hat: { inst: 'hat', mode: 'metal', tone: 8600, gain: 0.25, pan: 0.2, choke: 'hh' },
    ohat: { inst: 'hat', mode: 'metal', open: true, decay: 0.08, gain: 0.2, pan: 0.25, choke: 'hh' },
    shaker: { inst: 'shaker', gain: 0.15, pan: -0.3 },
    bass: { inst: 'sawBass', cut: 800, decay: 0.18, octave: 1, gain: 0.5, harmonics: -8 },
    keys: { inst: 'epiano', index: 1.2, tine: 0.6, decay: 0.6, trem: 0.15, gain: 0.55, send: 0.35, voicing: 'close', center: 64, size: 3 },
    pad: { inst: 'pad', cut: 1400, attack: 0.25, release: 0.7, detune: 8, chorus: 0.5, gain: 0.34, send: 0.45, voicing: 'close', center: 60, size: 3 },
    lead: { inst: 'supersaw', cut: 5500, hp: 250, attack: 0.008, release: 0.15, spread: 0.8, gain: 0.24, send: 0.3, dsend: 0.2, octave: 5 },
  },
  progression: ['I', 'V', 'vi', 'IV'],
  chordBars: 1,
  // E D C G E: each a chord tone or a plain 9th/11th/6th of the chord under it (G is the 7th over Am)
  motif: { degrees: [2, 1, 0, 4, 2], rhythm: 'X..x..x.X...x...', voice: 'keys' },
  grids: {
    intro: { pad: { hold: true, gain: 1.3 }, shaker: 'xoxoxoxoxoxoxoxo', keys: { grid: 'C.......C.......', gate: 0.8 }, hat: '..x...x...x...x.' },
    verse: { pad: 'hold', kick: 'X...X...X...X...', hat: '..x...x...x...x.', keys: { grid: '..C...C...C...C.', gate: 0.5 },
      bass: { grid: '..R...R...R...R.', gate: 0.7 } },
    drop: {
      pad: 'hold', kick: 'X...X...X...X...', clap: '....X.......X...', hat: '..x...x...x...x.', ohat: '..x...x...x...x.',
      shaker: 'xoxoxoxoxoxoxoxo', keys: { grid: '..C..C....C..C..', gate: 0.5 }, bass: { grid: '..R.O.R...R.O.R.', gate: 0.7 },
    },
    dropfill: { kick: 'X...X...X.......', clap: '....X.......XXXX' },
    end: { pad: { hold: true, gain: 1.3 }, keys: { grid: 'C...............', gate: 1 }, bass: { grid: 'R...............', gate: 1 } },
  },
  sections: [
    { name: 'intro', bars: 2, energy: 1, grid: 'intro', motif: { voice: 'keys', every: 2 } },
    { name: 'verse', bars: 4, energy: 2, grid: 'verse', motif: { voice: 'keys', every: 2 }, fx: ['riser', 'gap16'] },
    { name: 'drop', bars: 8, energy: 3, grid: 'drop', fill: { grid: 'dropfill', every: 4 }, motif: { voice: 'lead', every: 2 } },
    { name: 'end', bars: 2, energy: 1, grid: 'end', prog: ['V', 'I'] },
  ],
  ringFade: 0.6,
  mix: {
    duck: { by: ['kick'], depth: 0.45, beats: 0.5, targets: ['music'] },
    reverb: { size: 0.8, damp: 0.35, wet: 0.75 }, delay: { beats: 0.75, fb: 0.3, lp: 3500, wet: 0.7, spread: 1 },
    monoBelow: 120, width: 1.1,
  },
});
```
### D. Liquid drum & bass: F# dorian, 176 BPM, 30 s (22 bars), owner-approved

The harmony and sound of the launch score the owner **approved**: F#m9 · B9 · Amaj7 · G#m7 (i9 IV9 IIImaj7 ii7, every
tone in F# dorian), changing every half bar at the peak, the F# 6/9 Picardy chord to end; off-beat m9 stabs, an
electric piano comp, a saw bass over a sine sub, swung hats, rim ghosts and a shaker; the hook a soft FM bell (ratio
1.4) doubled by a supersaw in the drops and an octave up at the peak. The hook is written as notes, each one a tone of
the chord under it (`top(t)`), so it can never land a passing tone. The approved score also pitched its UI cue sounds
(a cue sheet) on `top(t)`; this file is that score without the cues. Measured: harmony ok (486 pitched notes; 601 with
the approved cue sheet), −13.6 LUFS, −1.1 dBTP, `linear` ok, mono 0.2 LU, phone 5.8 LU, both gaps ≥ 30 dB, ring ending
PASS; `map` −26.2 | −27.9 | −12.7 | −14.2 | −15.2 | −12.5 | −19.6 | −12.5 | −12.5 | −20.2 LUFS. One WARN kept: a shaker
onset inside the pre-peak gap. Its `reel.config.mjs`: `bpm: 176, duration: 30`.
```js
// RECIPE D (owner-approved): liquid drum & bass for a 30 s launch reel. F# dorian, 176 BPM (felt 88), 22 bars = 30.0 s.
// The harmony of the owner's approved launch score: F#m9 - B9 - Amaj7 - G#m7 (i9 IV9 IIImaj7 ii7, every tone in F#
// dorian), off-beat minor-9 stabs, an electric piano, a soft FM bell hook (ratio 1.4) doubled by a supersaw in the drops,
// the F# 6/9 Picardy chord to end. Every pitched note is a tone of the chord sounding then (its 7th and 9th included):
// the hook is built from the chord's own tones, never a passing tone. The approved score also pitches its UI cue
// sounds (sheet cues) on chord tones of `chordAt(t)`; add those with `cues: { ... }` when the reel has a cue sheet.
// BARS must list the chord of every bar of sections[] (22 here): the hook reads its notes from it.

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

export default ({ config, T }) => {
  const BAR = T.bar(1), STEP = T.s16(1);
  // the chord at a time (a note within 20 ms of a chord change belongs to the new chord)
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

    mix: {
      duck: { by: ['kick', 'boom', 'final'], depth: 0.42, beats: 0.5, targets: ['music'] },
      reverb: { size: 0.8, damp: 0.38, wet: 0.75 },
      reverbBus: { beat: 0.5, music: 1, sfx: 0.9 },
      delay: { beats: 0.75, fb: 0.3, lp: 3400, wet: 0.7, spread: 1 },
      hp: 28, monoBelow: 130, width: 1.1,
    },
  };
};
```
What the reel gets from each: kicks from `kick`, snares from `snare` and `clap`, the melody from the motif's
statements and the other notes of its voices, a chord event on every bar, and the sections (energy 4 reads as 3).

## Sources

[1] Attack Magazine, Roger Linn on swing (practice; the definition is his MPC design): https://attackmagazine.com/features/interview/roger-linn-swing-groove-magic-mpc-timing/2
[2] Brettworks, Roger Linn on groove and J Dilla (practice): https://brettworks.com/2013/07/23/roger-linn-on-drum-machine-groove-and-j-dillas-off-beat-sound/
[3] Toussaint, The Euclidean Algorithm Generates Traditional Musical Rhythms (research): https://cgm.cs.mcgill.ca/~godfried/publications/banff.pdf
[4] Nominal male vowel formants after Peterson & Barney 1952 (research data): https://www.cs.princeton.edu/courses/archive/spr99/cs325/formants.html
[5] Tiptop Audio HATS808, six square oscillators (vendor, signal): https://modulargrid.net/e/tiptop-audio-hats808
[6] Karplus-Strong: https://en.wikipedia.org/wiki/Karplus%E2%80%93Strong_string_synthesis · https://ccrma.stanford.edu/~jos/pasp/Karplus_Strong_Algorithm.html
[7] FM synthesis (Chowning): https://en.wikipedia.org/wiki/Frequency_modulation_synthesis
[8] Shepard tones in film (secondary, signal): https://kottke.org/18/05/hans-zimmers-clever-use-of-the-shepard-scale-in-dunkirk · https://www.premiumbeat.com/blog/shepard-tone-sound-design-filmmaking
[9] FFmpeg filters (loudnorm, ebur128, silencedetect, aphasemeter, astats): https://ffmpeg.org/ffmpeg-filters.html
[10] BRAAAM, overuse acknowledged by its popularisers: https://en.wikipedia.org/wiki/BRAAAM
[11] Amapiano log drum (practice, signal): https://articles.roland.com/?p=67237 · https://beatstorapon.com/blog/how-to-make-amapiano-beat/
[12] Chiptune voices: https://en.wikipedia.org/wiki/Chiptune · [13] Gated reverb snare (practice): https://www.attackmagazine.com/technique/tutorials/how-to-get-big-80s-drums/
