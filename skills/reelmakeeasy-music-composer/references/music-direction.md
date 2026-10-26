# Music direction: tempo, sync, arc, harmony, motif

Read this before you write a reel's `music.mjs`, when the plan gets its `## Music` lines. This file decides *what* the
music is and *why*. How to build and measure it: `music-synthesis.md`. The reel's type is in `reel/brief.md`; how
scenes follow the music is the `reelmakeeasy-motion-reel` skill.

Evidence marks: `[n]` = sources at the end · `(practice)` = production convention, not a measurement · `(physics)` =
acoustics or arithmetic · `signal` = vendor, platform-funded or single-source; never quote it as fact.

Contents: 0 Ground rules · 1 When to compose, when not · 2 Concept · 3 Tempo from the reel · 4 Sync · 5 Cut density ·
6 Arc, energy, openings, endings · 7 Sound worlds · 8 Harmony rules and bass · 9 Motif and sonic logo · 10 Four stable
recipes · 11 The legal rule · 12 What to write down · Sources

## 0. Ground rules

1. **Stable first.** A clash held against a chord, a mode that never settles or a lead whose overtones fight the key
   makes the reel unusable, and it has to be made again. Familiar keys, tempos, grooves and progressions are fine and
   preferred: they are familiar because they work. Never add a "surprise" chord, a foreign sound or an unusual mode to
   sound different. The composer's harmony check (§8) must pass before the score is used.
2. **You cannot hear.** Measurement checks the harmony arithmetic, loudness, peaks, gaps, mono fold and the ending,
   never whether the music is good or whether a plucked string sounds like a guitar. Say what was verified by
   measurement; the user's ear judges the rest when the reel renders in the chat.
3. **Start from a recipe** (§10): a proven, consonant starting point. Adapt its tempo, key, sections, sounds and motif
   to the reel; keep its rules.
4. **Time is in bars and beats.** The reel is whole 4/4 bars at one tempo; the picture follows the score's grid
   (`beat(n)`, `bar(n)` in the scenes), so write the music first and the scenes on it.
5. **Sync accents, not everything** (§4). **Melody builds memory, rhythm builds energy** (Lemon [7], signal). If the
   reel's name or product lands only at the end, the motif is the early cue (§9).
6. **Never copy** (§11), and never a culture's sound as a costume (§8).

## 1. When to compose, when not

The composer is synth-native: oscillators, noise, envelopes and filters. Compose the idioms that are *made* of those
sounds: house, garage, drum & bass, synthwave, techno, chiptune, ambient pads, electronic pop (§7).

An idea that needs real players (strings, a choir, a jazz combo, solo piano, a realistic orchestra) is not faked here:
with this toolkit it sounds like a 1990s General MIDI module, and no measurement will reveal it (practice). Tell the
user in one line that the idea wants a produced track, and offer ElevenLabs Music (the motion_music engine
"eleven-music") or a library track, or pick an electronic world instead. Never call a synthesized score
"orchestral", "acoustic", "a jazz combo" or "strings".

**Voices that imitate.** When a voice in front imitates a voice or a real instrument (`vox`, `choir`, `ks`, `piano`,
`upright`, `brass`), name it in your reply after the render and ask the user whether it reads as that. Synth voices
used as themselves (`pulse`, `fm`, `sine`, `supersaw`, `pad`, `epiano`, `pluck`, `acid`, `e808`, `reese`) need no
question.

## 2. Concept

1. **One sentence:** "The music is <world> at <tempo>, <mood>, because <reason from the subject and the reel's type>."
   Pick the world and mood for the subject (§7), then the recipe that fits (§10).
2. **Sound-picture relation**, chosen on purpose: parallel (accent-locked) · music-led edit · silence-led. A parallel
   reel still plans one moment where the picture rests while the music plays on.
3. **UI and impact sounds** (clicks, ticks, pops, whooshes) stay unpitched or very short (§8 timbre rule): a tick,
   a click, a filtered noise. A pitched UI sound plays a chord tone of the chord sounding then.
4. **Synchresis:** a sound and an image that coincide fuse into one event [13]. Give the reel a few designed sounds
   instead of a stock whoosh on every transition.

Sync-device pool: melody-as-UI (each appearing element on the next motif note) · silence cuts (the picture cuts only
when the music stops) · tempo = progress · call and response (the motif asks, a second voice answers) · assembly
(each section adds one visualised instrument) · filter = focus (a closing low-pass mirrors depth of field) · heartbeat
→ beat · typing as drums (unpitched clicks) · rest as accent (the biggest visual event lands on a rest).

Clients usually want (practice): instrumental · a clear sound in the first 0.5 s · room to read (thin the arrangement
under copy) · a decisive ending · a reusable motif.

## 3. Tempo from the reel

Formulas (physics): `beat = 60/bpm` · `16th = 15/bpm` · `bar = 240/bpm` in 4/4 · frames per beat = `30·60/bpm` at the
reel's 30 fps.

**The reel's bar count.** ReelMakeEasy makes the reel whole bars: `bars = round(length × bpm / 240)` with the length
the user asked for (10, 15, 30 or 60 s). Your sections must add up to exactly that. Tables (4/4, the reel's length):
- 10 s: 4 → 96 · 5 → 120 · 6 → 144 · 7 → 168
- 15 s: 5 → 80 · 6 → 96 · 7 → 112 · 8 → 128 · 9 → 144 · 10 → 160 · 11 → 176
- 30 s: 9 → 72 · 10 → 80 · 11 → 88 · 12 → 96 · 13 → 104 · 14 → 112 · 15 → 120 · 16 → 128 · 17 → 136 · 18 → 144 ·
  19 → 152 · 20 → 160 · 21 → 168 · 22 → 176
- 60 s: `bpm = 4·bars` (24 → 96, 26 → 104, 28 → 112, 30 → 120, 32 → 128, 34 → 136, 36 → 144, 43 → 172).
Any tempo works; the reel is then that many bars and a little shorter or longer than asked (15 s at 136 BPM is 9 bars,
15.88 s). Say so if it differs by more than a second.

Start inside the world's window (§7); half or double time counts. 120-128 BPM is the natural home of house and pop:
use it freely.

Choose in this order:
1. **Arousal and valence.** Tempo mainly drives arousal, mode drives valence; staccato reads high-arousal, legato low
   [3]. Pick a band below, then a mode (§8).
2. **Hero gesture.** A flip or drop reads in ~0.4-0.7 s (practice). If it lands on beats, the beat must be at least
   that long, or the picture rides a half-time grid.
3. **Copy load.** ~238 words/min silent reading [6]: budget ≥ 0.3 s per word + 0.5 s per line, in beats. One short word
   per beat works up to ~140 BPM; above that, one word per 2 beats.
4. **Structure falls out of tempo.** A 4-bar phrase is 10 s at 96, 8 s at 120, 5.6 s at 172: slow means fewer, longer
   sections. An odd bar count is fine: a 1-2 bar intro or a 2-bar ending absorbs it.

| Band | Feel | Natural picture grid |
|---|---|---|
| 60-80 | intimate, reflective | one change per bar or per 2 beats |
| 80-95 | laid-back, cool | per 2 beats on the backbeat |
| 95-112 | walking, conversational | per beat in bursts, per bar for holds |
| 112-128 | pop, house: confident, danceable | per beat / per bar |
| 128-138 | driving, urgent | per beat; 8th bursts ≤ 1 bar |
| 138-150 (felt 69-75) | heavy, swaggering | half-time backbeat (beat 3) |
| 150-180 (felt 75-90) | rushing, euphoric | half-time picture; 16th stutters only in bursts |

**Felt vs grid tempo.** A pulse is easiest to lock onto between ~80 and 160 BPM, with a preference near 120 (~2 Hz);
outside it listeners re-map to half or double time [2]. Decide the picture's felt tempo separately from the grid.
Above ~140 the picture rides half-time; below ~80 let micro-motion ride 8ths.

**Frame-exact tempi** at 30 fps (whole frames per beat): 60 72 75 90 100 112.5 120 150 180. Other tempi work: cuts
round to the frame at or just before the beat.

**Engine limits.** One tempo, 4/4 for a reel. No tempo maps: accelerate with cut density and subdivision at a
constant tempo (§5), or **hit-point solve**: to land beat n on an event T seconds in, `bpm = 60·n/T` (then check the
bar count).

## 4. Sync: which picture event gets which sound

| Tier | Musical layer | Picture events | Budget per 30 s |
|---|---|---|---|
| T0 Structure | phrase boundaries, fills, harmonic arrival | a new section's palette or layout | 3-7 |
| T1 Hero | the drop: low hit + transient + chord + tail; silence before | the reel's big move (not a global shake) | 3-5, ≤ 1 per 5-8 s |
| T2 Beat | kick, snare, clap | cuts inside a section, layout steps, pops | 10-30 |
| T3 Sub-beat | hats, ticks, keys | micro-motion, typing, counters, particles | free, ≤ ~4 distinct sounds/s |
| T4 Continuous | pads, beds, filter automation | camera drift, background flow, idle loops | always on |

- **Land on the beat, launch before it.** Sync is judged by where a movement *ends* (extreme point, contact, bottom
  of a bounce); onsets on beats did not read as synced [1]. Start the move early.
- **Never late.** Audio leading picture is noticed sooner (ITU-R BT.1359: ~45 ms audio-lead vs ~125 ms audio-lag
  detection [12]). The visual change sits on the frame with the transient or one frame before.
- **Anti-Mickey-Mousing.** Scoring every action reads cartoonish [10]. Each beat, give the sound to the object the eye
  is on (Murch's eye-trace [8]) and leave the rest to the music; viewers predict sync and fill the gaps [1].
- **Hero hits stay rare**, each followed by 0.5-1.5 s of near-stillness [16]. A gap of one 16th to one beat before
  the biggest hit lands it "on air" (practice; section `gap16`/`gap8`).
- **On the beat without cutting:** 2-4 % scale pulse on the kick · 5-10 % light pulse on the snare (WCAG-safe) ·
  elements popping on motif notes · LFO periods of whole bars.

## 5. Cut density

Levels: `D0` hold ≥ 2 bars · `D1` one change per bar · `D2` per half-bar (backbeat) · `D3` per beat · `D4` per 8th
(bursts ≤ 1 bar). Count *attention resets* = cuts + major transformations.
- About 12-25 resets per 30 s, not 60 (practice, after shot-length data [4][5]).
- **Packets, not uniformity.** Shot lengths in film run in packets of similar length, then change [4]: vary the
  density by section.
- D4 never longer than 1 bar · D0 after every hero hit · ≤ D1 while copy is read · half-time grid above ~140 BPM.
- **Complementary density:** busy music (16th hats, arps) → calmer picture; slow picture over fast music gives
  gravity. In melodic passages cut on melody notes, or not at all [7].
- Every full-frame luminance flip counts toward WCAG 2.3.1: ≤ 3 per second [15].

## 6. Arc, energy, openings, endings

Energy layers (practice; the section `energy` the composer and the picture read, 0-4): **0** pad, a solo motif
fragment · **1** + light percussion, filtered, bass absent or held · **2** + kick and backbeat, bass, chords · **3** +
full drums, lead, wider stereo · **4** + extra percussion, lead octave doubling, maximum brightness (the picture reads
4 as 3). Move on phrase boundaries; signal an upshift with a 1-2 bar riser or fill; downshift with a filter close or a
hard stop. Energy changes the arrangement, never the key or the mode.

| Arc | Shape | Fits |
|---|---|---|
| A Cold-open drop | hook sound at 0 → gap → full drop at bar 2 → plateau with one variation → resolve | ads, social, showreels |
| B Slow burn | a steady rise over ~85 % of the runtime; one hit at the very end | brand films, showreels |
| C Two-drop | drop at ~25 %, breakdown, bigger drop at ~70 %, short resolve | showreels, launches, social |
| D Reverse arc | open at full energy, strip to a solo motif for the name or product reveal | showreels, brand films |
| E Build and drop | intro, build, one drop for the main section, short ending | launches, 15-30 s social |
| G Half-time pivot | same bpm; drums go half-time at the midpoint | ads, social, showreels |
| H Accelerando | density ramps at one tempo (8ths → 16ths), then settles | showreels, social |
| I Loop-perfect | 8 or 16 bars, no ending; the last bar prepares the first | loops |

**Tension and release devices** (how to build them: `music-synthesis.md` §9): noise riser → zoom, blur, brightness up ·
accelerating roll → D2 → D4 (WCAG) · filter build → desaturate or defocus, snap back on the drop · breakdown →
negative space · pre-drop gap (a 16th to a beat) → black, frozen or held frame · tape stop → freeze, "power-down" ·
half-time switch → heavier, slower objects · a sus4 resolving to the triad on the hit → asymmetry locking symmetric.
- **Release rule:** a drop changes ≥ 3 dimensions at once (bass back, drums full, the tonic chord arrives, and the
  picture changes colour, scale or space).
- **Build, break, drop:** dancers synced most with and rated highest the build-up and drop; drops gave the largest
  skin-conductance responses [17]. The biggest transition goes on the drop; strip elements in the break before it.
- **Expectation:** medium syncopation maximises pleasure and the urge to move [18]. Establish the groove in 2 bars and
  vary it with fills and drop-outs, not with new harmony.

**Openings** (first sound at 0.00-0.10 s): the motif solo over its chord · mid-phrase or mid-drop · a pickup putting
the first downbeat hit at 0.4-0.6 s. Never a 2 s pad fade-in.

**Endings** (`audio.ending`, `ring` in `reel.config.mjs`): the tonic chord (or a plain cadence into it: V-I, IV-I,
VI-VII-i in natural minor, all in the key) ringing ≥ 1.5 s into the reel's last moment; the end card holds it. A
minor piece ends on its minor tonic.

## 7. Sound worlds

Tempo ranges are genre conventions [g]. All are synth-native: compose them as they are. Every world uses the harmony
rules (§8) and harmonic lead sounds; its drums carry its character.

| Sound world | BPM (felt) | Mood | Signature |
|---|---|---|---|
| House / pop-house | 118-128 | bright, confident | four-on-the-floor kick, offbeat open hats, clap on 2 and 4, offbeat bass, epiano or pad chords, supersaw lead |
| Minor launch / progressive | 120-128 | determined, cinematic | four-on-the-floor, minor triads, plucked arpeggio, sub and saw bass on roots, a supersaw hook in the drop |
| UK garage / 2-step | 130-136 | slick, nocturnal | swung 16th hats (55-60 %), skipping kick, m7/m9 stabs, a bass bending root to octave |
| Drum & bass / liquid | 170-176 (85-88) | velocity, euphoria | two-step break, sub with harmonics, reese on roots, pads in minor 7ths; never the Amen break [21] |
| Synthwave | 80-118 | retro-futurist | gated snare, octave saw bass, 16th arps on chord tones, supersaw or square lead |
| Lo-fi / chill electronic | 70-90 | cosy, calm | swung low-passed drums, epiano maj7/m7 chords, soft sine or pluck lead |
| Minimal techno | 122-130 | precise, hypnotic | one-note bass on the root, short pluck figures, slow filter development |
| Amapiano | 110-115 | smooth, hypnotic | log drum playing the bass on roots and fifths, swung shakers, restrained kick, long layering |
| Chiptune | 120-160 | playful, nerdy | pulse waves at 12.5/25/50 % duty, triangle bass, noise drums, arpeggios of chord tones |
| Ambient pad | 60-90, sparse grid | spacious, calm | held pads and drones on the triad, slow filter, sparse sine or epiano notes; swells, not hits |

Kick and snare names matter: ReelMakeEasy finds kicks and snares by instrument or by name (`kick…`, `snare…`,
`clap…`), so the picture gets its pulse.

## 8. Harmony rules and bass

The composer's harmony check (`node tools/score.mjs --harmony`, and the `harmony` line of every full run) measures the
score's notes against these rules and FAILs it, with every clash, chord and note listed, when one breaks. `motion_music`
refuses a score whose check did not pass.

**Mode** (practice, consistent with mode-valence findings [3]): Ionian (major) bright, resolved · Mixolydian casual,
anthemic · Dorian cool, hopeful minor (groove worlds) · Aeolian (natural minor) serious, determined. These four only:
lydian, phrygian, locrian, harmonic minor, pentatonic, blues, whole-tone and diminished scales are refused as the
piece's mode.

**One key and one mode.** The whole piece sits in it. A section may move to the relative major or minor only (A minor
↔ C major: the same notes), and then with a cadence into it. No mode switch between sections, no `transpose` key lift,
no section `key` or `mode` that changes the notes. Set the key and mode at the top of `music.mjs`: a section with no
key may not hold a pitch (only short ticks).

**No dissonance, ever** (the owner's rule). **Richness comes from 7ths and 9ths, swing, off-beat stabs and layering,
never from a note outside the chord.** The owner called a plain-triad score "built by students": voice the chords as
m9, maj7, m7 and 9th chords whose tones are in the key, and keep every melody note one of those tones.

**Chords.**
- Triads; 7th and 9th chords (maj7, m7, 7, m9, maj9, 9, add9, 6/9) on any degree whose tones are all in the key: IV9
  in dorian (B9 in F# dorian: B D# F# A C#), V7 in major, i9 and IIImaj7 in dorian. A 7th chord with a tone outside
  the key (D7 in C major, its F#: a secondary dominant) is outside the key and fails. sus2 and sus4 that resolve to
  the triad.
- Never #11, b9, #9, altered, augmented, diminished or half-diminished chords: each puts a tritone or a minor 9th over
  the root.
- A slash chord's bass is one of its own chord tones (`C/E`, `Am/C`). A pedal only on the tonic or the dominant, and
  only under chords that contain that note (`Ab/Eb` over an Eb pedal: yes; `F/Eb`, `Gm7/Eb`: never).
- Every chord in the key. No borrowed chord: no bVI, bVII or iv in a major key, no bVI in dorian (Dmaj7 in F#
  dorian: use Amaj7, IIImaj7), no major tonic in the middle of a minor piece. A chord from the parallel major or minor
  is a mode switch, and the check refuses it. Two exceptions: the major V or V7 of a minor key (E or E7 in A minor;
  its 3rd is the leading tone, allowed over that chord only), the plain minor-key cadence; and a minor (aeolian or
  dorian) piece's last chord on its tonic's major, a Picardy ending (F# 6/9, F# A# C# D# G#, ending F# dorian; its A#
  is allowed over that last chord only). The same chord anywhere before the end fails.

**Melody.** Every note, on every step, is a chord tone (the chord's 7th and 9th included) or the chord's plain
extension (the 9th over any triad, the 11th over a minor chord, the 6th over a major chord, the 7th the chord
implies). **No passing or neighbour tones at all**: not on a beat, not on the 'and', not as a short step on a weak
16th, and no chromatic note anywhere. Never the 11th over a major chord (a minor 9th above its third), never a b9, #9
or #11 (a G# over Dmaj7), never the 6th over a minor chord (a tritone with its third). A motif note that does not fit
the chord under it: state the motif over a chord that holds all its notes, or change the note. Whole semitones only.

**Bass.** Roots and fifths on every note; octaves fine; no approach notes (`A` in a grid fails the check). Never a
tritone against the chord. Every note below C3 is the
bass, whatever plays it: a piano, pluck or epiano down there follows the same rule. Practice: roots in E1-E2; offbeat roots or octave 8ths over
four-on-the-floor, root-octave bends in garage, kick-following roots in half-time, the log drum on roots and fifths in
amapiano. Kick and bass are never both long on one downbeat unless ducked. Give every bass harmonics so phone
speakers can play it (`music-synthesis.md` §10).

**Timbre.** Lead, hook, chord and bass voices are harmonic: their overtones sit on the harmonic series, so they agree
with the chord. `epiano`, `pluck`, `supersaw`, `pad`, `stab`, `sine`, `pulse`, `organ`, saw and square leads and
basses, `fm` with an integer `ratio` (1, 2, 3, 4), and the `bell` on any ratio (its partials read as a bell, not as a
second pitch: the owner approved the 1.4 bell in two scores). Inharmonic sounds (`glass`, `modal`, `bar`, `membrane`,
`wood`, `ceramic`, `rattle`, `shing`, plates and other object modes, `fm` with a ratio such as 2.32 or 3.5) only as unpitched percussion or a very short UI tick, never holding a pitch (> 0.15 s) against a chord, whatever
their kind or bus (a foley or drum instrument given a note is checked like a lead).

**No held clash.** Two voices a minor 2nd, major 7th or tritone apart (in any octave) for 0.15 s or more FAIL, unless
both are tones of the chord symbol sounding (a maj7's own 7th over its root, a m9's own 9th against its third, a V7's
own tritone). An added 9th, 11th or 6th that is not in the symbol is not a chord tone here: a 13th held against the
chord's 7th, or a 6th a tritone from a minor 3rd, fails. A pad's release tail after its gate is not counted; a struck
voice's ring is.

**Voicing (practice):** no 3rds below ~C3, close voicings moving by the smallest step (`voicing: 'close'`), top voice
moving by step; pads in 200 Hz-2 kHz so the lead owns 2-6 kHz.

**Harmonic rhythm** follows energy: a chord per bar (energetic), per 2 bars (calm), per half-bar into a climax.

**End cadence:** V-I (definitive) · IV-I (warm) · VI-VII-i in natural minor (heroic) · V-i in minor with the major V
(firm). The final chord, the key's own tonic, rings.

**Never a pentatonic "oriental" riff.** The major pentatonic played as a run of parallel fourths over a gong, a
"Chinese" or "Japanese" hook, a Phrygian-dominant snake-charmer line for "the Middle East", a harmonic-minor "exotic"
flourish: these are stereotypes, not music about the subject, and they read as mockery. The same for "tribal" drums,
chants, fake languages and any instrument used as a costume.

## 9. Motif and sonic logo

Derive the motif, then fit it to the chords. Methods:
1. **Speech rhythm:** the stress pattern of the name or line becomes the rhythm (stressed = long or accented).
2. **Cryptogram:** letters A-G are pitch names; map the others by alphabet index mod 7 onto scale degrees [22]
   (`cryptogram('<word>', 7)` in `tools/audio/theory.mjs`).
3. **Mark geometry → contour:** rising diagonal → rising line · circle → returns to its first note · zig-zag →
   alternating leaps.
4. **Numbers:** a version or model number becomes a note count.

Then check every note that lands on a beat, or lasts longer than an 8th, against the chord under it (§8 melody). A
motif that repeats over several chords needs notes that fit all of them on the beats: common tones (C and E fit both
Am and C), or state it only over the chords it fits (`every: 2` over a 4-chord loop lands on chords 1 and 3).

Melody rules (practice): 3-5 notes within an octave + 3rd · mostly stepwise with one leap, then a step back the other
way · keep the rhythm and vary pitch, or the reverse · questions end off the tonic, answers on it · the motif's peak
note meets a visual peak.

**The motif drives the picture.** Every motif note becomes a melody accent (`melody(0.8)`) in the reel: state it where
words, cards or icons should pop, one element per note.

**Motif through the reel:** first quiet and alone over its chord → doubled by the lead in the drop → as a bass figure
on roots → in octaves at the peak → resolved on the end card. All in the one key. Tools: augmentation, diminution,
retrograde (the composer's `aug dim retro`), octave doubling. Re-check the beats after a transform: `aug` moves notes
onto new beats, `invert` and `shift:n` change the pitches.

**Sonic logo** = the motif's final statement, 2-5 notes over ~1-3 s [23] (vendor, signal). Plant it in the first 3 s
and resolve it on the end card on the tonic or the 3rd. Bespoke cues beat borrowed songs [24] (secondary, signal).

## 10. Four stable recipes

Proven, fully consonant starting points; each passes the harmony check and is in `music-synthesis.md` §16 as a complete
`music.mjs` with its measured QC. Pick the one nearest the reel's mood and adapt it: the tempo (then the bar count),
the key (move every chord with it), the sections and their lengths, the sounds, the motif (re-check its beats). Keep
the chord types, the bass on roots and the harmonic lead. Richness comes from the 7ths and 9ths, the swing, the stabs
and the layering (A and D), never from a note outside the chord; B and C are triad-based, so voice them with 7ths and
9ths in the key.

| Recipe | Key, mode | Tempo | Progression | Groove | Fits |
|---|---|---|---|---|---|
| A Garage loop (the owner's liked track, Dmaj7 → Amaj7) | F# dorian | 136 | F#m9 · B9 · Amaj7 · G#m7 (i9 IV9 IIImaj7 ii7), Amaj7 · C#m7 in the break, Amaj7 · E into the drops, F# 6/9 Picardy to end | swung 2-step: skipping kick, swung 16th hats, off-beat m9 stabs, bass root-octave, bell (ratio 1.4) hook doubled by a supersaw | sleek product showreels, tech, nightlife, 30-60 s |
| B Minor launch | A minor (aeolian) | 128 | Am · F · C · G (i VI III VII) | four-on-the-floor, clap on 2 and 4, offbeat bass, plucked arpeggio, supersaw hook | launches, apps, sport, determined 15-30 s |
| C Bright pop-house | C major | 124 | C · G · Am · F (I V vi IV), V-I to end | four-on-the-floor, offbeat open hats, offbeat epiano chords, bass root-octave | friendly products, lifestyle, social, 15-30 s |
| D Liquid DnB (**owner-approved** launch score) | F# dorian | 176 (felt 88) | F#m9 · B9 · Amaj7 · G#m7 (i9 IV9 IIImaj7 ii7), per half bar at the peak, F# 6/9 Picardy to end | liquid two-step break, swung hats, off-beat m9 stabs, epiano comp, saw bass over a sine sub, bell (ratio 1.4) hook doubled by a supersaw | launches, apps, fast 30 s reels |

Other keys work the same way: move the recipe's key and its chords together (B in E minor: Em C G D; C in G major:
G D Em C).

## 11. The legal rule

Never copy or imitate a song, an artist, a melody, a film score or a sonic logo, and never "make it sound like X". No
4+ note sequence with the same pitches *and* rhythm as a known tune, no recreated signature sound, no soundalike voice.
Soundalikes are a legal risk, not a loophole (*Midler v. Ford* [19]; the "Blurred Lines" verdict effectively protected
a "feel" [20]). When the user names a reference they like, it can set the world, the tempo band and the mood; write
your own melody, chords and sounds.

## 12. What to write down

In `reel/plan.md`, a `## Music` section before the scenes (fill every line):
```
concept:     The music is <world> at <tempo>, <mood>, because ...
recipe:      A | B | C | D (music-synthesis.md §16), changed: tempo ... key ... sections ... sounds ...
tempo:       ... BPM · felt ... · groove ... · bars ... = round(length × bpm / 240)
harmony:     key ... mode ... (major | minor | dorian | mixolydian) · progression ... · harmonic rhythm ... · end cadence ...
motif:       method ... · degrees/rhythm ... · the chords it is stated over (its beats are chord tones) · sonic logo at bar ...
sections:    name bars energy, ... (they add up to the bar count)
arc:         ... · sync device ...
ask the ear: the voices that imitate a voice or an instrument (§1), or none
```
Then write `music.mjs` (key, mode, voices, grids per section, progression, motif, sections with energy; `step(ctx)`
only where data can't say it), set `bpm` in `reel.config.mjs`, run `node tools/score.mjs --no-cues --harmony` until it
passes, then the full score. Build and measure with `music-synthesis.md`.

## Sources

[g] Genre tempo conventions: Ableton https://learningmusic.ableton.com/make-beats/tempo-and-genre.html · Digital DJ Pool
https://digitaldjpool.com/blog/dj-bpm-guide/ · Orphiq https://orphiq.com/resources/bpm-tempo-guide · Wikipedia genre
articles.
[1] Takehana, Uehara & Sakaguchi 2019, PLOS One: https://pmc.ncbi.nlm.nih.gov/articles/PMC6711538/ · [2] McKinney & Moelants 2006 (cites Moelants 2002): https://cspeech.ucd.ie/rppw/rppw10/mckinney/abstract.html
[3] Eerola, Friberg & Bresin 2013, Frontiers in Psychology: https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2013.00487/full
[4] Cutting et al. 2011, i-Perception: https://pmc.ncbi.nlm.nih.gov/articles/PMC3485803/ · Cutting, DeLong & Nothelfer 2010: https://www.sciencedaily.com/releases/2010/02/100223121435.htm
[5] MacLachlan & Logan, TV commercial shot length (WARC): https://www.warc.com/Content/421e1376-baa5-472f-aa9d-adc58bea5146 · [6] Brysbaert 2019 reading rate (BPS): https://www.bps.org.uk/research-digest/most-comprehensive-review-date-finds-average-persons-reading-speed-slower
[7] Lemon, Orlando Wood/System1/IPA (~200 ads from a testing firm; industry evidence): https://lbbonline.com/news/ipa-publishes-lemon-a-repair-manual-to-reverse-the-crisis-in-creative-effectiveness
[8] Murch, Rule of Six: https://nofilmschool.com/2016/11/6-rules-good-cutting-according-oscar-winning-editor-walter-murch
[10] Mickey Mousing: https://en.wikipedia.org/wiki/Mickey_Mousing
[12] ITU-R BT.1359 via TV Technology: https://www.tvtechnology.com/opinions/av-synchronization-how-bad-is-bad · [13] Chion, synchresis: https://www.filmsound.org/chion/sync.htm
[15] WCAG 2.3.1: https://www.w3.org/WAI/WCAG21/Understanding/three-flashes-or-below-threshold.html
[16] Practitioner: https://global.sumaart.com/share/650.html · https://designingsound.org/2014/06/05/the-negative-space-of-sound/ · [17] Solberg & Jensenius 2017: https://doaj.org/article/a06c41eeed7e4b52a9098bef18260a50
[18] Witek et al. 2014, PLOS One: https://doi.org/10.1371/journal.pone.0094446 · [19] Midler v. Ford (9th Cir. 1988): https://en.wikipedia.org/wiki/Midler_v._Ford_Motor_Co.
[20] Williams v. Bridgeport ("Blurred Lines"): https://en.wikipedia.org/wiki/Pharrell_Williams_v._Bridgeport_Music · [21] Amen break: https://en.wikipedia.org/wiki/Amen_break
[22] Musical cryptogram: https://en.wikipedia.org/wiki/Musical_cryptogram · [23] HEARDIS, sound logo (vendor): https://www.heardis.com/services/sound-logo/
[24] Ipsos, distinctive brand assets (secondary summaries of a 2020 meta-analysis): https://www.ipsos.com/en-us/knowledge/media-brand-communication/power-you-why-distinctive-brand-assets-are-driving-force-creative-effectiveness
