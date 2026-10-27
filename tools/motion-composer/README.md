# Motion composer

A sample-free music composer: `score.mjs` turns a reel's `music.mjs` (data the agent writes: voices, grids, harmony,
a motif, sections) into a mastered score, then measures it. `audio/*.mjs` holds its 80 synthesized instruments, the
grids and swing, harmony and voicing, bus effects and cue sounds. Everything is deterministic (seeded) and needs only
Node and FFmpeg.

It is the claude-motion-reel skill's composer, vendored here unchanged except for what ReelMakeEasy needs (below).

## How ReelMakeEasy uses it

When the user picks music **composed by the agent** for a Motion Reel (the `composer` music engine):

1. Setting up the reel copies this folder (without this README) into the chat's `reel/music/tools/`, replaced on every
   setup, and writes `reel/music/reel.config.mjs` (the agent's `bpm` in it is kept).
2. The agent follows the `reelmakeeasy-music-composer` skill (`skills/reelmakeeasy-music-composer/`): it writes
   `reel/music/music.mjs` and runs `node tools/score.mjs --no-cues` in its own sandboxed shell, then fixes what the QC
   reports.
3. `motion_music` with `engine: "composer"` takes the result (only when its harmony and kick checks passed). The API never imports or runs `music.mjs` or this code:
   it reads `audio/score.wav`, and `build/music.json` and `qc/score-report.json` as plain JSON
   (`apps/services/api/src/agent/motion-reel/motion-composer.ts`), and builds the reel's exact beat grid and music
   events from them.

## What changed from the original

- `build/music.json` also carries `voices` (each voice's instrument and bus) and `motif` (every motif statement's notes
  as `[time, velocity, voice]`): the API reads them to know which hits are kicks, snares and melody.
- A listening slice (`--window`, `--around`, `--from-bar`, `--section`, `--bars`) writes `audio/sketch.wav` by default
  and refuses `--out audio/score.wav`: ReelMakeEasy takes `audio/score.wav` as the whole score.
- A harmony check (`audio/harmony.mjs`): every pitched note, cue sounds included, against stability rules (allowed
  modes, one key set wherever a pitch is held, stable chords in the key (7th and 9th chords whose tones are in the key; no
  borrowed chord but a minor key's V / V7 and a Picardy last chord), slash basses, whole semitones, chord tones (or
  their plain 9th/11th/6th) on every step with no passing tones, bass on roots and fifths, no held m2/M7/tritone
  between voices, no inharmonic voice but the bell holding a pitch). It runs on every full score (`harmony` in the console and in
  `qc/score-report.json`, FAIL = exit 3, and the API refuses a score without a PASS) and alone with `--harmony`. Added
  after a score that passed every loudness check was plainly dissonant.
- A kick check (`audio/kick.mjs`): the owner approved one kick only, `{ inst: 'kick', f0: 200, f1: 55, pitchTau: 0.008,
  decay: 0.1, click: 0.65, drive: 1.3, gain: 0.7 }` with no harmonics layer, and the kick instrument's defaults are now
  that kick (the original's were f0 150, f1 48, pitchTau 0.03, decay 0.22). A kick-like voice with pitchTau > 0.012 s,
  decay > 0.15 s or a harmonics layer (a voice `mix.duck.by` ducks on counts as a kick, whatever plays it), an e808 hit
  that slides down (or any e808 glide as a cue or raw hit), any other hit (tom, conga, boom, logdrum, bloop, sweep...)
  that slides into <= 120 Hz slower than 0.012 s with a tail > 0.15 s and is played 3 times or more, and a harmonics
  layer on any voice whose pitch moves FAIL it: the elastic "rubber band" kick the owner rejected twice. `logdrum`'s
  `dropTime` default is 0.012 s (was 0.025). It
  runs with the harmony check (`kick` in the console and in `qc/score-report.json`, FAIL = exit 3, and the API refuses
  a score without a PASS); the phone advice no longer suggests harmonics on a kick or a gliding voice.
- Messages that pointed at tools ReelMakeEasy does not ship (`export_cues.mjs`, `borrow.mjs`, `align_audio.mjs`,
  `render.cjs`) now say what to do here instead. `export_cues.mjs` (it needs the original's scene engine) is left out.

`node tools/score.mjs --help` has the full `music.mjs` schema; `--list` the instruments.
