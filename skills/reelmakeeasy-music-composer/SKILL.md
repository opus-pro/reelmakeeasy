---
name: reelmakeeasy-music-composer
description: Compose a Motion Reel's own music note by note with ReelMakeEasy's composer (reel/music/music.mjs, run with node tools/score.mjs), when the user picked music composed by the agent (motion_music engine composer). Stability first: one key in major, minor, dorian or mixolydian, 7th and 9th chords whose tones are in the key, every note a chord tone (no passing tones), harmonic lead sounds, a harmony check that must pass. Covers the harmony rules, four stable recipes to start from (one owner-approved), tempo and bar arithmetic, the music.mjs format, mixing and the measured QC.
---

# Compose a Motion Reel's music

Use this when the reel's music is yours to compose (`engine: "composer"` in `reel/brief.md`, or the user asked you to write the music). You write the score as data in `reel/music/music.mjs`; the composer (sample-free instruments, a master and a measured QC) renders it in your own shell. ReelMakeEasy then puts it under the reel with its exact grid: every kick, snare, motif note, chord and section you wrote is an event the picture can hit.

**Stable comes first.** Unstable music (a clash held against a chord, a mode that never settles, a lead whose overtones fight the key) is the worst thing this skill can produce: the whole reel has to be made again. Familiar keys, tempos, grooves and progressions are fine and preferred. Never trade stability for novelty: no "surprise" chord, no foreign sound, no unusual mode to sound different.

Depth lives in two references. Read them before you write the first `music.mjs`:

- `references/music-direction.md`: *what* the music is and why. Tempo from the reel, sync, arc and energy, sound worlds, the harmony rules in full, the motif, the four stable recipes, the legal rule.
- `references/music-synthesis.md`: *how*. The music.mjs format, voices, grid strings, swing and feel, sections and motif, the instruments (which ones are harmonic), mix, endings, the QC checks, and the four recipes as complete `music.mjs` files.

`node tools/score.mjs --help` and `--list` (from `reel/music/`) are authoritative for the format and the instruments; where a reference disagrees, follow the tool.

## Harmony rules

The composer's harmony check measures every rule below and FAILs the score on a break; only a sus that resolves and a cadence into the relative key are yours to keep. The owner's rule: no dissonance, ever.

**Richness comes from 7ths and 9ths, swing, off-beat stabs and layering, never from a note outside the chord.** The owner called a plain-triad score "built by students": voice the chords as m9, maj7, m7 and 9th chords whose tones are all in the key, and make every melody note one of those tones.

- **Mode:** major (`ionian`), natural minor (`aeolian`), `dorian` or `mixolydian`. Never lydian, phrygian, locrian, harmonic minor, pentatonic, blues, whole-tone, diminished or chromatic as the piece's mode.
- **One key and one mode for the whole piece,** set at the top of `music.mjs`: a section with no key may not hold a pitch. A section may move to the relative major or minor (A minor to C major) only, and then with a cadence into it. No mode switch (minor intro, lydian drop), no `transpose` key lift.
- **Every chord in the key.** No borrowed chord: no bVI, bVII or iv in a major key, no bVI in dorian (Dmaj7 in F# dorian), no major tonic in the middle of a minor piece. A chord from the parallel major/minor is a mode switch. Two exceptions: the major V or V7 of a minor key (E or E7 in A minor), the plain minor-key cadence; and a minor (aeolian or dorian) piece's **last** chord on its tonic's major (a Picardy ending, e.g. F# 6/9 ending an F# dorian piece).
- **Chords:** triads; 7th and 9th chords (maj7, m7, 7, m9, maj9, 9, add9, 6/9) on any degree, as long as every tone is in the key (B9 in F# dorian, G7 in C major: yes; D7 in C major, its F# outside: no); sus2 and sus4 that resolve to the triad. Never #11, b9, #9, altered, augmented, diminished or half-diminished chords.
- **Bass:** roots and fifths (octaves fine) on every note, never a tritone against the chord, no approach notes. This holds for every note below C3, whatever plays it (a piano or pluck in the bass register is the bass). A slash chord's bass is one of its own chord tones; a pedal only on the tonic or the dominant, and only under chords that contain that note (never `F/Eb`, `Gm7/Eb`).
- **Melody:** every note, on every step, is a tone of the chord sounding then (its 7th and 9th included) or the chord's plain 9th, the 11th of a minor chord, the 6th of a major chord. **No passing or neighbour tones at all**, not even a short step on a weak 16th, and no chromatic notes. A motif whose notes do not all fit a chord is stated over another chord, or its note changes. Whole semitones only: no microtonal degrees.
- **Timbre:** lead, hook and chord voices are harmonic: `epiano`, `pluck`, `supersaw`, `pad`, `stab`, `sine`, `pulse`, saw and square leads, `fm` with an integer `ratio` (1, 2, 3, 4), and the `bell` on any ratio (its partials read as a bell: the owner approved the 1.4 bell twice). Inharmonic sounds (`glass`, `modal`, `bar`, `membrane`, `wood`, `ceramic`, `rattle`, `shing`, plates, `fm` with a non-integer ratio such as 2.32) only as unpitched percussion or very short UI ticks, never holding a pitch (> 0.15 s) against a chord, whatever bus they play on.
- **No held clash:** two voices a minor 2nd, major 7th or tritone apart for 0.15 s or more, unless both are tones of the chord symbol sounding (a maj7's own 7th, a m9's own 9th, a V7's own tritone). An added 9th, 11th or 6th is not a chord tone here: keep it away from the chord's other notes by a semitone or a tritone.

Start from a recipe (`music-direction.md` §10, the code in `music-synthesis.md` §16): A a garage loop in F# dorian (the owner's liked track), B a minor launch track in A minor, C a bright pop-house track in C major, D liquid drum & bass in F# dorian (the owner-approved launch score). A and D carry the 7th and 9th chords; B and C are triad-based, so give them 7ths and 9ths in the key. Change the tempo, key, sections and sounds to fit the reel; keep the rules.

## Rules that are never broken

- **No copying.** Never copy or imitate a song, an artist, a melody, a film score or a sonic logo, and never "make it sound like X". No 4+ note run with the same pitches and rhythm as a known tune.
- **No clichés of a place or people.** Never a pentatonic "oriental" riff, a gong-and-pentatonic "Asia", a "tribal" chant, a fake language, a sitar drone for "India", a bandoneon for "Latin". Never any ethnic or national stereotype as a sound.
- **One kick: the owner-approved one.** `{ inst: 'kick', f0: 200, f1: 55, pitchTau: 0.008, decay: 0.1, click: 0.65, drive: 1.3, gain: 0.7 }` with no `harmonics` layer (the kick instrument's defaults, recipe D). A slow pitch slide (`pitchTau` > 0.012 s), a long tail (`decay` > 0.15 s), a harmonics layer on a kick or on any voice that glides, a sliding 808 hit (`e808` with `from`/`slide`), and any other hit that slides into the kick register (<= 120 Hz) slower than 0.012 s with a tail > 0.15 s played as a beat (a `tom`, `conga`, `boom`, `logdrum`, `bloop`... on every beat: the same kick under another name) are the elastic "rubber band" kick the owner rejected twice. A voice that `mix.duck.by` ducks on is the kick and is held to the kick's limits. The composer's kick check FAILs them (exit 3) and `motion_music` refuses the score.
- **The harmony check must pass.** `node tools/score.mjs` prints a `harmony` line; a FAIL (exit code 3) lists every clash, chord and note to fix, and `motion_music` refuses the score until it passes.
- **You cannot hear.** The QC measures harmony arithmetic, the kick, loudness, peaks, mono, phone band, silences, gaps and the ending, never whether it sounds good. In replies say what was checked by measurement, and never claim how the music sounds ("punchy", "warm", "catchy"). The user hears it in the chat when the reel renders: ask them to listen to the hook, the drop and the ending.
- **ReelMakeEasy owns `reel/music/tools/`**: it is replaced on every setup; never edit it. Run only `node tools/score.mjs`; never install packages or fetch anything. No samples: every sound is synthesized.

## The workflow in a Motion Reel

1. **Read** `reel/brief.md` (type, length, frame, subject) and the subject's words. The reel's look and the music decide each other: plan them together.
2. **Decide the music** with `music-direction.md` and write it at the top of `reel/plan.md` under `## Music` (the template is its §12): the recipe you start from, the world, tempo, arc, key and mode, progression, motif, ending.
3. **Tempo and bars.** The reel is whole 4/4 bars: `bars = round(length × bpm / 240)` with the reel's asked length (15 s at 136 BPM: round(8.5) = 9 bars, 15.88 s). Pick the tempo for the concept first, then read the bar count; choose another tempo that suits the concept if the count does not fit your phrases. The sections in `music.mjs` must add up to **exactly** that many bars, and the ring-out happens inside the last bars (put the final chord 1.5 s or more before the end). `motion_music` refuses another count and says the right one.
4. **Write `reel/music/music.mjs`** and set `bpm` in `reel/music/reel.config.mjs` to your tempo (music.mjs reads `config.bpm`; ReelMakeEasy rewrites the rest of that file on every setup and keeps your bpm). 4/4 only: the reel's grid is 4/4.
5. **Check the harmony and the kick first**: `cd reel/music && node tools/score.mjs --no-cues --harmony` (a few seconds, no master). Fix every line it lists and run it again until it prints `ok harmony` and `ok kick`.
6. **Render and measure**: `node tools/score.mjs --no-cues`. Read the console (sections, the `harmony` line, the `map` line of loudness per section, every `WARN` and `FAIL`) and `qc/score-report.json`; open `qc/audio.png` when a check points at something you can see (gaps, clipping, the arc). Fix every FAIL (exit code 3) and every WARN you can, and run it again. The arc must show in the `map` line: the break clearly down, the drop up.
7. **Put it under the reel**: call `motion_music` with `engine: "composer"` and no prompt. It checks the score is newer than your music.mjs, is the reel's bars and passed the harmony and kick checks, then rewrites `public/music.wav`, `public/reel.json` and `music-map.md` from your score. Then read `music-map.md` again and plan the scenes on your own sections, kicks and motif notes (the motion-reel skill).
8. **Later changes** are free: edit, run the composer, call `motion_music` again, re-check the scenes.

## Commands (from `reel/music/`)

```bash
node tools/score.mjs --no-cues --harmony  # the harmony and kick checks alone: key, mode, chords, bass, melody, clashes, timbres, elastic kicks (exit 3 = FAIL)
node tools/score.mjs --no-cues            # the full score: audio/score.wav, build/music.json, qc/score-report.json, qc/audio.png
node tools/score.mjs --help               # the music.mjs schema
node tools/score.mjs --list               # 80 instruments with parameters, voice inserts, scales
node tools/score.mjs --no-cues --around dropB --out audio/sketch.wav   # about 10 s around a section, in whole bars
node tools/score.mjs --no-cues --solo lead,bass      # audition voices at the mix's gain (never overwrites the score)
node tools/score.mjs --no-cues --seed 7   # same structure, new humanize and arpeggio rolls
```

A slice (`--around`, `--bars`, `--from-bar`, `--section`, `--window`) writes `audio/sketch.wav` (never `audio/score.wav`), reports to `qc/score-report-window.json` and leaves `build/music.json` alone: run the full score before `motion_music`. `--mux` and `--stem` are not used here. An optional cue sheet (`build/cues.json`, then run without `--no-cues`) adds designed hit sounds at given seconds; the format is in `music-synthesis.md` §8, and pitched cue sounds count in the harmony check like any note. The reel's own sound effects (`<Sfx>`) stay in Remotion, so most reels need none.

## What the picture gets

ReelMakeEasy reads `build/music.json` as data. Kicks: `kick` instruments or voices named `kick…` (an `e808` or `sub` when there is none). Snares: `snare`/`clap`, by instrument or name. Melody: every motif note (strength 1, the accents `melody(0.8)` returns) and the other notes of the voices the motif plays on (1 when accented, else 0.6). Chords: your chord changes. Sections: your sections, energy 0-3 (4 counts as 3). So the arrangement *is* the picture's score: state the motif where new elements should arrive, put the drop where the biggest reveal is, give each section its own layer of the arrangement. The picture answers the music with new things (an arrival, a reveal, a cut, a counter step), never by bumping or flashing the same element on every note or kick.

## The reply after composing

One or two lines: the title `motion_music` gave (key, mode, tempo), the recipe or world and arc in plain words, and what the QC measured (harmony check passed, loudness, true peak, phone band, ending; any WARN left and why). Never how it sounds. Ask the user to listen to it in the next render.
