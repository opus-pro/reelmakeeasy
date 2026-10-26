# Music synthesis: write, voice, mix and measure `music.mjs`

Read this after the plan's `## Music` lines are filled from `music-direction.md` (concept, tempo, arc, motif, material
palette). This file is the *how*: the format, grids and feel, instruments, mix, endings, measurement, and a worked
example. **`node tools/score.mjs --help` and `--list` (run in `reel/music/`) are authoritative** (they describe
`tools/audio/*.mjs`); where this file disagrees, follow the tool and say so.

Evidence: (physics) acoustics or arithmetic · (practice) production convention · [checked] measured with this composer
by its authors · signal = vendor or single source · `[n]` = sources at the end. Nothing here is a default.

Contents: 1 Loop · 2 Top-level fields · 3 Voices · 4 Grid strings · 5 Feel: swing, humanize, feel changes · 6 Harmony,
motif, sections, step · 7 Instruments and materials · 8 An optional cue sheet · 9 Transition and tension recipes ·
10 Mix · 11 Endings · 12 Measurement QC · 13 Slices and auditions · 14 Score → picture · 15 Anti-generic moves ·
16 Worked example · Sources

## 1. Loop and commands

Everything runs in `reel/music/`, in your shell. `tools/` is ReelMakeEasy's copy of the composer: never edit it.

```bash
node tools/score.mjs --no-cues    # music.mjs -> audio/score.wav + .mp3, build/music.json, qc/audio.png, qc/score-report.json
node tools/score.mjs --list       # 80 instruments + parameters, voice inserts, voice keys, cue kinds, scales
node tools/score.mjs --no-cues --around <section|bar> --out audio/sketch.wav   # about 10 s (whole bars) around a section's start
node tools/score.mjs --no-cues --from-bar <n> [--seconds s | --bars n] | --section <name> [--bars n] | --window a-b
node tools/score.mjs --no-cues --seed <n>    # same structure, new humanize / arpeggio / texture rolls
node tools/score.mjs --no-cues --solo v1,v2 | --mute v1,v2   # audition at the full mix's gain, never over the score
```
- Exit 0 = written (WARN = advice) · 1 = refused/error · 3 = a QC FAIL (true peak or ending). It refuses without
  `music.mjs` or with `sections: []`: there is no fallback music.
- `reel.config.mjs` holds `bpm` (yours), meter `'4/4'`, the reel's `duration`, and `audio: { ending: 'ring', lufs: -14,
  tp: -1 }`. Read `config.bpm` and `config.meter` in `music.mjs` (`export default ({ config }) => ({ bpm: config.bpm,
  ... })`). Without a cue sheet the score's length is the sum of its sections: make them the reel's bars
  (`music-direction.md` §3).
- Loop: edit → score → read the console `map` line, `qc/score-report.json`, `qc/audio.png` → fix. A full render
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
  says kick, a snare when its instrument is `snare`/`clap` or its name says snare or clap (name a found-sound kit's
  thud `kick_<object>`). Composer keys:
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
  Pitched: `R` root · `3 5 7 9` · `O` octave · `A` approach (a semitone under the next chord's bass) · `C` whole chord;
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
- **Never ship a grid verbatim** from the worked example, a reference or another doc: change ≥ 3 cells per row, add or
  remove a voice, write the 4th-bar variation (practice).

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
  `'V/V'`, pedal `'V>I'` (V over the I bass) · diatonic stacks `1 '4^7' '2^9'` · names `'Ebmaj9' 'D/C'` · MIDI arrays
  literal · `'-'` no chord. Per section: `prog`, `chordBars`, `key`, `mode`, `transpose` (a key lift = `transpose: 1|2`
  on one section). Chord-token bass lines follow the bass of slash and pedal chords. Every chord change is a chord
  event in the reel.
- **Motif** `{ degrees, rhythm (grid), voice }`, stated by `section.motif` (`true` | `'<transform>'` | `{ voice,
  transform, bar, beat, every, times }`) or by `play: { <voice>: 'motif:<transform>' }`. Transforms `retro invert aug
  dim shift:<n>`, chained with `+`. Derive the degrees (`music-direction.md` §9); cryptogram helper:
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
- **Sparse worlds** (ambient M04, sound-design-only M25): `'hold'` drones and pads per chord change, sparse events from
  `step()` with `rng`, whole bars left near-silent on purpose. The reel still needs a grid: keep a quiet pulse (a rim,
  a tick) so the picture has kicks or snares to follow, or plan the picture on the motif.

## 7. Instruments (80, sample-free) and material palettes

All oscillators, noise, envelopes and filters; `--list` has every parameter. You can't judge timbre: acoustic idioms
come out as toy/FM/lo-fi versions (`music-direction.md` §1). A voice in front that imitates a voice or a real source
means asking the user's ear after the render (`music-direction.md` §1 has the list and the naming test).

| Family | Instruments | Recipe notes |
|---|---|---|
| Kick, sub | `kick e808 sub` | kick = sine f0 → f1, τ 20–40 ms, decay 0.15–0.4 s, click (practice); `e808` `slide`/`from` glides over `glide`; `drive` is grit, not a phone fix: the voice key `harmonics` is (§10). A `kick` voice is the reel's kick track |
| Snare, hats | `snare clap hat ride shaker rim cowbell chipnoise` | metallic hat = six inharmonic squares [5]; `snare gated` [13]; `chipnoise` LFSR long/short [12]. `snare` and `clap` voices are the reel's snare track |
| Tuned, hand perc | `tom conga taiko logdrum membrane wood body brush` | tune to scale degrees; `logdrum` = pitched bass, pitch drop + 1:1 FM knock [11]; `body` chest/thigh/snap/stomp; `brush` swirl/tap |
| Bass | `sawBass reese acid wobble upright triangle` | `wobble div` locks the LFO to beats; `acid` `accent` and `from` (slide over `glide`, 60 ms); all need harmonics (§10) |
| Keys, plucks | `pluck ks epiano piano organ fm bell pulse blip sine arpSaw` | `ks` Karplus-Strong, feedback .990–.998, `strum` [6]; `epiano` 1:1 body + tine FM [7]; `piano` (`felt`) is the weakest emulation; `pulse` duty 12.5/25/50 % + `arp` fake chords [12] |
| Modal | `bar glass modal` (`material`, `shape`) | free-free bar 1:2.756:5.404:8.933 · tuned bar 1:4:10 · circular membrane 1:1.594:2.136:2.296:2.653:2.918:3.156 (physics) · glass 1:2.32:4.25:6.63 = starting values. `ratios` takes a preset name (`'free'`, `'tuned'`, `'glass'` …) or an array. `modal shape` derives the modes from an object: found-sound recipes below |
| Object gestures | `rattle scrape` | physical models over the modal body: a drop settling in bounces (restitution `e`), a click train at speed / ridge spacing |
| Pads, voices | `pad supersaw stab brass vox choir drone braam` | supersaw 7 saws 0/±6/±12/±20 cents; `vox`/`choir` formants, male /a/ 730·1090·2440 Hz, ×1.15–1.2 female/child [4]; `braam`: once at most, with a reason [10] |
| Textures | `vinyl hiss wind` (+ `mix.tape`) | crackle hides synthesis; leaning on it is the lo-fi cliché |
| Transition fx | `boom riser whoosh sweep downlifter shepard doppler aperture snip shutter crackle bloop` | §9; Shepard weights by sin² so wraps are silent [8] |
| Foley | `ceramic paper tapepull squish boing degauss channel shing bubble gel fabric stamp shatter click` | `degauss hum` 50 Hz (60 in the Americas) |

**Material palette → instruments** (one family per reel, `music-direction.md` §2): wood `wood`, `modal
material:'wood'`, short `bar` · glass `glass`, `modal 'glass'`, soft transient · membrane/drum-like `membrane tom
taiko` · metal `bell` (ratio 1.4 or 3.5), `shing`, `modal` with ratios you choose · ceramic `ceramic` · paper `paper`,
`crackle`, `tapepull` · water `bubble bloop` · rubber/gel `gel squish boing` · fabric/air `fabric wind whoosh` ·
digital/pure `blip bell fm sine` (the least distinctive).

**Found-sound recipes (M26, M25).** What makes a found-sound kit is in `music-direction.md` §7. A found sound is built
from its object: the **shape** sets the mode ratios, the **size and material** set the pitch and the decay, the
**gesture** sets the excitation. Every number below comes from *your* object (its real size; ask the user when it
matters); the placeholders are the point:
```js
import { plateHz, tubeHz, OBJECT_MATERIALS } from './tools/audio/instruments.mjs';
const PANEL = plateHz({ a: <long side m>, b: <short side m>, h: <thickness m>, material: '<steel|aluminium|glass|acrylic|abs|plywood|card>' });
voices: {
  // 1 struck panel (a lid, a card, a phone back, a sign): aspect = the mode pattern, strike = where it is hit
  panel:  { inst: 'modal', shape: 'plate', aspect: <a / b>, strike: [<u 0..1>, <v 0..1>], f: PANEL,
            decay: OBJECT_MATERIALS.<material>.tau, hard: <.2 fingertip .. .9 nail, key or coin> },
  // 2 shell (a cup, glass, can, bowl): the ring series 1 : 2.83 : 5.42 : 8.77; pitch from tapping the object
  rim:    { inst: 'modal', shape: 'ring', note: <its tapped pitch>, decay: <s>, tilt: <.4 glassy .. .9 dull> },
  // 3 drop and settle: impacts at first·(1 - e^k)/(1 - e), each e x the last, ringing the object's own modes
  settle: { inst: 'rattle', e: <restitution>, first: <s>, n: <impacts>, shape: '<its shape>', note: <...>, decay: <s> },
  // 4 drag, zip, ratchet, scroll: clicks at speed / ridge spacing; periodic = a pitch, jitter 1 = crinkle
  zip:    { inst: 'scrape', v0: <m/s>, v1: <m/s>, spacing: <ridge pitch m>, jitter: <0..1>, f: <its body Hz>, shape: '<...>' },
  // 5 air column (a bottle neck, a tube, a cap's pop): closed = odd harmonics, open = all
  neck:   { inst: 'modal', shape: 'tube', ends: '<closed|open>', f: tubeHz({ L: <m>, r: <m> }), noise: <.4-.7> },
}
```
- Starting values for the gesture (practice): restitution `e` ≈ 0.2-0.4 for a cased phone on a desk, 0.5-0.6 for
  wood on wood, 0.8-0.9 for a coin or a steel ball on stone; `first` = the first rebound's flight (a drop of a few cm
  ≈ 0.05-0.15 s); a gesture's speed 0.05-0.5 m/s over its own ridge pitch.
- Ratios are ideal (a simply supported plate, a thin ring, an unflanged tube): a starting point. No recordings, no
  samples.
- Each object is pitched twice: its physical pitch from the formula, then rounded to the reel's scale, or the reel's
  key is taken from it. One object can be three voices (struck, dropped, dragged): that is how a kit stays one world.
- Measured [checked by the composer's authors]: a glass panel 147 × 71 × 0.6 mm (`plateHz` 361 Hz) shows its predicted
  plate modes within 0.6 %; the ring shows 1 : 2.83 : 5.42 at 0 / −11 / −23 dB; a closed 200 mm tube of radius 12 mm
  sounds at 413.6 Hz with odd harmonics only. Measurement proves the physics, not that a viewer hears "a lid": ask.

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
| Fake drop · key lift | a section with one soft element, the real drop a bar later · `transpose: 1` or `2` on the last section | once at most · a known cliché: knowingly |
| Suspension → resolve | `'Vsus4'` or a pedal `'V>I'` through the build, tonic on the hit | |
| Displacement | `rotate` a figure's pattern one cell further each section, or move the motif's `beat` per statement | snaps home on the drop |
| Ducked hit | `mix.duck.by` takes voices (`['kick']`) | §10 |

Rules: ≤ 1 whoosh per 4 bars, never two identical in a row · ≤ 1 ear-candy device per phrase · silence is the
strongest transition sound · a riser into every section is a re-roll default.

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
- Design the ending (a cadence by meaning, `music-direction.md` §8); a plain fade-out is a re-roll default.
- `button` (a dead stop on the final hit) and `loop` exist in the composer (`--ending`), but the reel fades its music
  on the last half bar, so keep `ring` unless the plan has a reason.

## 12. Measurement QC: `qc/score-report.json`

| Check | Measures | Pass | If not |
|---|---|---|---|
| `loudness` · `truepeak` | integrated LUFS, LRA · dBTP of the delivered file | ±0.5 LU · ≤ ceiling (FAIL, exit 3) | lower hit gains, re-render |
| `linear` | loudnorm pass-2 mode | linear | `master.pass1.input_lra` > 11 LU makes loudnorm ride the gain (dynamic): lift the quietest section or shorten long quiet stretches; a WARN you may keep when the arc needs its quiet break (say so) |
| `peaks` | limiter depth | ≤ 6 dB | hits too far above the bed (§10) |
| `mono` | LU lost folding to mono | ≤ 3 LU | phase: no Haas or detune in the lows; raise `monoBelow` |
| `phone` | LU lost after 2 × 200 Hz high-pass; on a WARN, a per-voice table and a `fix` line | ≤ 6 LU | the §10 recipe on the voice the table names |
| `silence` | silencedetect −45 dB ≥ 0.1 s [9] | all explained by gap / tapestop / ending | an accidental hole: a voiceless section, a `mute`, a short grid |
| `gaps` | the 150 ms after each gap vs the gap | ≥ 15 dB | no swell on the same hit; nothing playing into it |
| `onsets` | hero cues of a cue sheet (s ≥ .45): onset within ±30 ms | max ≤ 10 ms | give the hit a transient; no swell, slow attack or humanize on it |
| `ending` | the ring-out | last sample silent | a held final chord, ≥ 1.5 s before the end |

- **A FAIL refuses the score**: `motion_music` will not take it. Fix and run again.
- **Loudness map:** the console `map` line and `sectionLoudness` (momentary LUFS per section) must show the planned
  arc: louder with energy, the breakdown clearly down, the drop up. Sections of different energy within ~1 LU of each
  other make no audible step (practice heuristic).
- **Reading `qc/audio.png`** (open it: waveform L/R over a log spectrogram; yellow = sections; practice): drums =
  vertical lines · bass = bright band under ~120 Hz · pads = horizontal bands · risers = rising diagonals · gaps = dark
  columns · clipping = broadband smear at hits · a constant wide band below 60 Hz outside hits = mud.
- **What you say:** "checked by measurement (loudness, true peak, mono, phone band, gaps, ending), not by ear", the
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

## 15. Anti-generic moves

1 Change something every 2 bars; never loop 1 bar > 4 times unchanged (2-bar grids, `fill.every`) · 2 a fill on the
last beat of every 4-bar phrase, a bigger one every 8 (`fill: [{every: 4, …}, {bars: […]}]`) · 3 one instrument
foreign to the world, supplied by the subject's world · 4 the motif from the subject (`music-direction.md` §9) · 5 no
re-roll-default keys (D major, C minor, D minor, A minor): choose and justify · 6 one borrowed or secondary chord at
the reveal (that section's `prog`) · 7 one polymetric or polyrhythmic element (odd-length grid, `phase: 'global'`,
`steps`) · 8 swing decided per voice · 9 seeded humanize, small on kick, snare and motif · 10 automate filters, sends
and decays per section (per-note functions, section patterns, `fx` strings) · 11 ≤ 1 ear candy (reverse swell, delay
throw, tape stop) per phrase · 12 a counter-melody in the last third (`minEnergy` or late sections only) · 13
subtract: mute a layer for a bar (fill with `null`) · 14 the subject's own sounds as percussion (M26, §7) · 15 a
designed ending (§11) · 16 no "corporate happy" kit, no inspirational piano + four-on-the-floor + I–V–vi–IV, no
build-and-drop every 8 bars by habit · 17 never a grid verbatim (§4) · 18 shaped dynamics: crescendos through `o x X`,
not flat 1.0 · 19 move sounds in stereo with the picture's objects (`pan` functions) · 20 tune the drums: kick `f1`
near the root, toms and membranes on scale degrees, the log drum plays the bass.

## 16. Worked example (an example of the format; never reuse it verbatim)

A 60 s showreel at 136 BPM: round(60 × 136 / 240) = 34 bars, 60.0 s. It shows the format at work: a world, voices
with harmonics for phones, named grid sets per section, fills, a motif with transforms, a surprise chord, gaps before
the drops and a Picardy ending. Its world, tempo and key are now a re-roll default for unrelated reels: write your own
from your plan, with your own grids, harmony and motif. Measured (not heard): −13.9 LUFS, −1.0 dBTP, mono −0.1 LU,
phone 5.8 LU, both gaps ≥ 31 dB, ring ending PASS; the `map` line −15.9 | −13.8 | −13.8 | −24.6 | −12.4 | −13.6 | −17.2
| −32.6 LUFS shows the two-drop arc.

`reel/music/reel.config.mjs` (ReelMakeEasy writes it; only `bpm` is the agent's):
```js
export default { title: 'A 60 s product showreel', bpm: 136, meter: '4/4', duration: 60, fps: 30,
  audio: { ending: 'ring', lufs: -14, tp: -1 } };
```

`reel/music/music.mjs`:
```js
// EXAMPLE ONLY: never reuse it verbatim.
// Sound: a UK garage / 2-step bed for a 60 s product showreel (M01, synth-native).
// The world sounds slick and nocturnal: swung hats, a skipping kick, minor-9 stabs, a bent bass.
// Key F# dorian (cool, hopeful minor; the raised 6th, D#, is the colour). Not a stock loop: i9 - IV9 - IIImaj7 - ii7,
// one surprise chord (bVImaj7, Dmaj7) at the second drop, a Picardy ending (F# major 6/9) = problem solved.
// Arc two-drop: drop at bar 9 (~24 %), breakdown, bigger drop at bar 23 (~65 %), short resolve, ring ending.
// Motif (speech rhythm of the product's name): 5 notes, down a 4th by steps with one leap, answered on the tonic.
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

  // 4 + 4 + 8 + 4 + 2 + 8 + 2 + 2 = 34 bars = the reel.
  sections: [
    { name: 'intro', bars: 4, energy: 1, grid: 'air', motif: { voice: 'bell', every: 2 } },
    { name: 'build', bars: 4, energy: 2, grid: 'build', motif: { voice: 'keys', every: 2, bar: 1 }, fx: ['riser', 'gap16'] },
    { name: 'dropA', bars: 8, energy: 3, grid: 'dropA', fill: { grid: 'dropAfill', every: 4 }, motif: { voice: 'lead', every: 2 } },
    { name: 'break', bars: 4, energy: 1, grid: 'brk', prog: ['F#m9', 'B9', 'Dmaj7', 'C#m7'], motif: { voice: 'bell', transform: 'aug', every: 4 }, fx: ['downlifter'] },
    { name: 'lift', bars: 2, energy: 2, grid: 'lift', prog: ['Dmaj7', 'E'], fx: ['riser', 'gap8'] },
    { name: 'dropB', bars: 8, energy: 4, grid: 'dropB', fill: { grid: 'dropBfill', every: 4 }, prog: ['F#m9', 'B9', 'Dmaj7', 'G#m7'], motif: { voice: 'lead', every: 2 }, play: { lead8: 'motif' } },
    { name: 'outro', bars: 2, energy: 2, grid: 'outro', prog: ['Dmaj7', 'E'], motif: { voice: 'bell', transform: 'retro' } },
    { name: 'final', bars: 2, energy: 1, grid: 'final', prog: [[42, 49, 54, 58, 61, 63, 68]], chordBars: 2 },
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
What the reel got from it: kicks from `kick`, snares from `snare` and `clap`, the melody from the motif's statements
on `bell`, `keys`, `lead` and `lead8`, a chord event on every bar, and the eight sections (dropB's energy 4 as 3). Its
console left two WARNs it explained: a shaker onset inside each pre-drop gap (move the shaker or `keep` the bus) and
`linear` (the quiet break pushed loudnorm to dynamic mode).

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
