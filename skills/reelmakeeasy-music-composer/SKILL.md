---
name: reelmakeeasy-music-composer
description: Compose a Motion Reel's own music note by note with ReelMakeEasy's composer (reel/music/music.mjs, run with node tools/score.mjs), when the user picked music composed by the agent (motion_music engine composer). Covers the sound world, tempo and bar arithmetic, harmony, motif, the music.mjs format, mixing and the measured QC.
---

# Compose a Motion Reel's music

Use this when the reel's music is yours to compose (`engine: "composer"` in `reel/brief.md`, or the user asked you to write the music). You write the score as data in `reel/music/music.mjs`; the composer (sample-free instruments, a master and a measured QC) renders it in your own shell. ReelMakeEasy then puts it under the reel with its exact grid: every kick, snare, motif note, chord and section you wrote is an event the picture can hit.

Depth lives in two references. Read them before you write the first `music.mjs`:

- `references/music-direction.md`: *what* the music is and why. Sonic concept, tempo from the reel, sync tiers, arc and energy, the sound worlds M01-M26, harmony and bass, motif derivation, originality and the re-roll defaults.
- `references/music-synthesis.md`: *how*. The music.mjs format, voices, grid strings, swing and feel, sections and motif, the 80 instruments, mix, endings, the QC checks, anti-generic moves, and a worked example.

`node tools/score.mjs --help` and `--list` (from `reel/music/`) are authoritative for the format and the instruments; where a reference disagrees, follow the tool.

## Rules that are never broken

- **No clichés of a place or people.** Never a pentatonic "oriental" riff, a gong-and-pentatonic "Asia", a "tribal" chant, a fake language, a sitar drone for "India", a bandoneon for "Latin". Never any ethnic or national stereotype as a sound. If the subject is from a culture, its music comes from the concept (materials, rhythm of its words, the product's own sounds), not from a costume.
- **No imitation of a named artist, song, film score or sonic logo**, and no "in the style of" a person. No 4+ note run with the same pitches and rhythm as a known tune. Original only.
- **Avoid the re-roll defaults** (`music-direction.md` §10): 120 or 128 BPM, 88/96/112 BPM, four-on-the-floor as the only groove, D major / C minor / D minor / A minor, the stock loops (I-V-vi-IV and its rotations, i-VI-III-VII, i-VI-VII-V, the lo-fi ii-V), the energy curve `0 2 2 2 2 3 0`, a riser into every transition, the "corporate happy" kit, a plain fade instead of a designed ending. Keeping one needs a one-line reason in the plan; with three or more, change the plan.
- **You cannot hear.** The QC measures loudness, peaks, mono, phone band, silences, gaps and the ending, never whether it sounds good. In replies say what was checked by measurement, and never claim how the music sounds ("punchy", "warm", "catchy"). The user hears it in the chat when the reel renders: ask them to listen to the hook, the drop and the ending. When a voice imitates a real voice, instrument or object (`vox`, `choir`, `ks`, `piano`, a named object sound), name it and ask whether it reads as one.
- **ReelMakeEasy owns `reel/music/tools/`**: it is replaced on every setup; never edit it. Run only `node tools/score.mjs`; never install packages or fetch anything. No samples: every sound is synthesized.

## The workflow in a Motion Reel

1. **Read** `reel/brief.md` (length, frame, subject), `reel/style.md` (its tempo range and mood) and the subject's words. The style card's look and the music decide each other: plan them together.
2. **Decide the music** with `music-direction.md` and write it at the top of `reel/plan.md` under `## Music` (the template is its §11): the sonic concept sentence, the world, tempo, arc, motif method, harmony, ending, which re-roll defaults you kept and why.
3. **Tempo and bars.** The reel is whole 4/4 bars: `bars = round(length × bpm / 240)` with the reel's asked length (15 s at 136 BPM: round(8.5) = 9 bars, 15.88 s). Pick the tempo for the concept first, then read the bar count; choose another tempo in the style's range if the count does not fit your phrases. The sections in `music.mjs` must add up to **exactly** that many bars, and the ring-out happens inside the last bars (put the final chord 1.5 s or more before the end). `motion_music` refuses another count and says the right one.
4. **Write `reel/music/music.mjs`** and set `bpm` in `reel/music/reel.config.mjs` to your tempo (music.mjs reads `config.bpm`; ReelMakeEasy rewrites the rest of that file on every setup and keeps your bpm). 4/4 only: the reel's grid is 4/4.
5. **Render and measure**: `cd reel/music && node tools/score.mjs --no-cues`. Read the console (sections, the `map` line of loudness per section, every `WARN` and `FAIL`) and `qc/score-report.json`; open `qc/audio.png` when a check points at something you can see (gaps, clipping, the arc). Fix every FAIL (exit code 3) and every WARN you can, and run it again. The arc must show in the `map` line: the break clearly down, the drop up.
6. **Put it under the reel**: call `motion_music` with `engine: "composer"` and no prompt. It checks the score is newer than your music.mjs and is the reel's bars, then rewrites `public/music.wav`, `public/reel.json` and `music-map.md` from your score. Then read `music-map.md` again and plan the scenes on your own sections, kicks and motif notes (the motion-reel skill).
7. **Later changes** are free: edit, run the composer, call `motion_music` again, re-check the scenes.

## Commands (from `reel/music/`)

```bash
node tools/score.mjs --no-cues            # the full score: audio/score.wav, build/music.json, qc/score-report.json, qc/audio.png
node tools/score.mjs --help               # the music.mjs schema
node tools/score.mjs --list               # 80 instruments with parameters, voice inserts, scales
node tools/score.mjs --no-cues --around dropB --out audio/sketch.wav   # about 10 s around a section, in whole bars
node tools/score.mjs --no-cues --solo lead,bass      # audition voices at the mix's gain (never overwrites the score)
node tools/score.mjs --no-cues --seed 7   # same structure, new humanize and arpeggio rolls
```

A slice (`--around`, `--bars`, `--from-bar`, `--section`, `--window`) writes `audio/sketch.wav` (never `audio/score.wav`), reports to `qc/score-report-window.json` and leaves `build/music.json` alone: run the full score before `motion_music`. `--mux` and `--stem` are not used here. An optional cue sheet (`build/cues.json`, then run without `--no-cues`) adds designed hit sounds at given seconds; the format is in `music-synthesis.md` §8. The reel's own sound effects (`<Sfx>`) stay in Remotion, so most reels need none.

## What the picture gets

ReelMakeEasy reads `build/music.json` as data. Kicks: `kick` instruments or voices named `kick…` (an `e808` or `sub` when there is none). Snares: `snare`/`clap`, by instrument or name; in a found-sound kit name the objects `kick_crate`, `snare_lid`, or the picture gets no pulse. Melody: every motif note (strength 1, the accents `melody(0.8)` returns) and the other notes of the voices the motif plays on (1 when accented, else 0.6). Chords: your chord changes. Sections: your sections, energy 0-3 (4 counts as 3). So the arrangement *is* the picture's score: state the motif where elements should pop, put the drop where the biggest reveal is, give each world its own section.

## The reply after composing

One or two lines: the title `motion_music` gave (key, mode, tempo), the world and arc in plain words, and what the QC measured (loudness, true peak, phone band, ending; any WARN left and why). Never how it sounds. Ask the user to listen to it in the next render.
