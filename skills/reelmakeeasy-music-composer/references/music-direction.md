# Music direction: concept, tempo, sync, arc, motif

Read this before you write a reel's `music.mjs`, when the plan gets its `## Music` lines. This file decides *what* the
music is and *why*. How to build and measure it: `music-synthesis.md`. The reel's look is in `reel/style.md`; how
scenes follow the music is the `reelmakeeasy-motion-reel` skill.

Evidence marks: `[n]` = sources at the end · `(practice)` = production convention, not a measurement · `(physics)` =
acoustics or arithmetic · `signal` = vendor, platform-funded or single-source; never quote it as fact. Nothing here is
a default: every value you use needs a reason from *this* reel's subject and style.

Contents: 0 Ground rules · 1 When to compose, when not · 2 Sonic concept · 3 Tempo from the reel · 4 Sync · 5 Cut
density · 6 Arc, energy, openings, endings · 7 Sound worlds M01-M26 · 8 Harmony and bass · 9 Motif and sonic logo ·
10 Originality checks · 11 What to write down · Sources

## 0. Ground rules

1. **You cannot hear.** Measurement checks loudness, peaks, gaps, mono fold and the ending, never whether a plucked
   string sounds like a guitar. Say what was verified by measurement; the user's ear judges the rest when the reel
   renders in the chat.
2. **Compose for this reel**: a `music.mjs` (data + optional `step(ctx)`) written from the subject, the style card and
   the plan. Nothing ships from a template: the worked example in `music-synthesis.md` §16 shows the format, never a
   score to reuse.
3. **Time is in bars and beats.** The reel is whole 4/4 bars at one tempo; the picture follows the score's grid
   (`beat(n)`, `bar(n)` in the scenes), so write the music first and the scenes on it.
4. **Sync accents, not everything** (§4). **Melody builds memory, rhythm builds energy** (Lemon [7], signal). If the
   reel's name or product lands only at the end, the motif is the early cue (§9).
5. **Original only.** Never imitate a named artist, a recognisable song, a film score or a famous sonic logo [19][20],
   and never a culture's sound as a costume (§8, §10).

## 1. When to compose, when not

The composer is synth-native: oscillators, noise, envelopes and filters. Some idioms are *made* of those sounds; some
can only be played as an openly artificial version; some need real players.

| Kind | What it is | Worlds (§7) | What to do |
|---|---|---|---|
| synth-native | Idioms where oscillators and noise *are* the authentic instruments: electronic, chip, minimal, ambient, foley-only, found-sound | M01 M02 M04 M07 M08 M10 M12 M13 M17 M18 M19 M20 M22 M25 M26 | Compose it. |
| stylised | An acoustic idiom played as an openly artificial version (toy, FM, chip, music-box, lo-fi). The artificiality *is* the style and the picture agrees (stepped, handmade, retro, miniature). | M03 M09 M11 M15 M16 M21 M23 M24 | Compose it, and write the sentence "a <toy/FM/chip/lo-fi/...> version of <idiom>, because <reason>" in the plan. |
| needs real players | Strings, choir, a jazz combo, solo piano, a realistic orchestra | M05 M06 M14 | Don't fake it. Tell the user in one line that this idea wants a produced track, and offer ElevenLabs Music (the motion_music engine "eleven-music", or a setup with that music) or a library track; or change the world. |

Why: Karplus-Strong, additive piano and detuned-saw strings are possible here, but with this toolkit they usually
sound like a 1990s General MIDI module, and no measurement will reveal it (practice). Never call a synthesized score
"orchestral", "acoustic", "a jazz combo" or "strings"; name what it is ("FM bell stabs", "a chip version of a waltz").

**Voices that imitate.** When a voice in front imitates a voice or a real source, only an ear can say whether it reads
as one: `vox` and `choir` (formant voices), vowel chops, `ks` (plucked string), `piano`, `upright`, `brass`, `epiano`
or `organ` presented as the real instrument, `taiko` `conga` `tom` `body` `brush` as a real kit, `bar` `glass`
`membrane` `modal` presented as a named instrument (marimba, glockenspiel, gong), and every object sound named after a
real object (the product's click, a lid, a zip). Name it in your reply after the render and ask the user whether it
reads as that ("does the lid tap at 0:08 read as a lid?"). Synth voices used as themselves (`pulse`, `fm`, `blip`,
`sine`, `supersaw`, `pad`, `acid`, `e808`, `reese`, `wobble`) need no question.

## 2. Sonic concept

1. **Sentence:** "The world of this reel sounds like ___ because ___." The reason comes from the subject and the style
   card. If the subject has materials (glass, paper, metal), the materials make the sounds.
2. **Four columns**, justified together in one line: **A** sound world (M id, or your own slug) · **B** one *foreign
   element* from outside that world, supplied by the subject's world · **C** arc (§6) · **D** sync device (pool below,
   or invent one and name it).
3. **One material palette** for any UI or foley-like voices: wood, glass, metal, ceramic, paper, water, rubber/gel,
   fabric/air, or digital/pure (the least distinctive). Pitch tonal UI sounds to the current chord.
4. **Sound-picture relation**, chosen on purpose: parallel (accent-locked) · counterpoint · silence-led · music-led
   edit · found-sound. A parallel reel still plans one moment where picture and music disagree [9].
5. **Synchresis:** a sound and an image that coincide fuse into one event [13]. Give the world its own sounds instead
   of a stock whoosh on every transition.

Sync-device pool: melody-as-UI (each appearing element on the next motif note) · visual polymeter (3-beat picture loop
over 4-beat music) · silence cuts (the picture cuts only when the music stops) · tempo = progress · call and response
(the motif asks, a second voice answers) · assembly (each section adds one visualised instrument) · key change =
palette change · filter = focus (a closing low-pass mirrors depth of field) · heartbeat → beat · typing as drums · rest
as accent (the biggest visual event lands on a rest).

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
- 60 s: `bpm = 4·bars` (24 → 96, 26 → 104, 28 → 112, 32 → 128, 34 → 136, 36 → 144, 43 → 172).
Any tempo works; the reel is then that many bars and a little shorter or longer than asked (15 s at 136 BPM is 9 bars,
15.88 s). Say so if it differs by more than a second.

Start inside the style card's tempo range and the world's window (§7); half or double time counts. 88, 96 and 112 BPM
are over-picked, and 120/128 are the default pop zone (§10): take another tempo unless the concept gives a reason.

Choose in this order:
1. **Arousal and valence.** Tempo mainly drives arousal, mode drives valence; staccato reads high-arousal, legato low
   [3]. Pick a band below, then a mode (§8).
2. **Hero gesture.** A flip or drop reads in ~0.4-0.7 s (practice). If it lands on beats, the beat must be at least
   that long, or the picture rides a half-time grid.
3. **Copy load.** ~238 words/min silent reading [6]: budget ≥ 0.3 s per word + 0.5 s per line, in beats. One short word
   per beat works up to ~140 BPM; above that, one word per 2 beats.
4. **Structure falls out of tempo.** A 4-bar phrase is 10 s at 96, 8 s at 120, 5.6 s at 172: slow means fewer, longer
   sections. Need more at a slow tempo? Use 2-bar sections or irregular phrases (3 bars = a stumble, 6 = an extension;
   practice). An odd bar count is fine: a 1-2 bar pickup or a 2-bar ending absorbs it.
5. **Re-roll check** (§10).

| Band | Feel | Natural picture grid |
|---|---|---|
| 60-80 | intimate, reflective | one change per bar or per 2 beats |
| 80-95 | laid-back, cool | per 2 beats on the backbeat |
| 95-112 | walking, conversational | per beat in bursts, per bar for holds |
| 112-126 | **default pop/house zone: only with a written reason** (a world whose native window sits here, M10 or M11, is one) | per beat / per bar |
| 126-138 | driving, urgent | per beat; 8th bursts ≤ 1 bar |
| 138-150 (felt 69-75) | heavy, swaggering | half-time backbeat (beat 3) |
| 150-180 (felt 75-90) | rushing, euphoric, nervous | half-time picture; 16th stutters only in bursts |

**Felt vs grid tempo.** A pulse is easiest to lock onto between ~80 and 160 BPM, with a preference near 120 (~2 Hz);
outside it listeners re-map to half or double time [2]. Decide the picture's felt tempo separately from the grid.
Above ~140 the picture rides half-time; below ~80 let micro-motion ride 8ths.

**Frame-exact tempi** at 30 fps (whole frames per beat): 60 72 75 90 100 112.5 120 150 180. Other tempi work: cuts
round to the frame at or just before the beat.

**Engine limits.** One tempo, 4/4 for a reel (the reel's grid is 4/4). No tempo maps: accelerate with cut density and
subdivision at a constant tempo (§5), or **hit-point solve**: to land beat n on an event T seconds in, `bpm = 60·n/T`
(then check the bar count).

## 4. Sync: which picture event gets which sound

| Tier | Musical layer | Picture events | Budget per 30 s |
|---|---|---|---|
| T0 Structure | phrase boundaries, fills, harmonic arrival, key change | a new section's world, palette or layout | 3-7 |
| T1 Hero | the drop: low hit + transient + chord + tail; silence before | the style card's big move (not a global shake) | 3-5, ≤ 1 per 5-8 s |
| T2 Beat | kick, snare, clap | cuts inside a section, layout steps, pops | 10-30 |
| T3 Sub-beat | hats, ticks, blips, keys | micro-motion, typing, counters, particles | free, ≤ ~4 distinct sounds/s |
| T4 Continuous | pads, drones, beds, filter automation | camera drift, background flow, idle loops | always on |

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
- **Packets, not uniformity.** Shot lengths in film run in packets of similar length, then change (a 1/f pattern [4]):
  vary the density by section, not by habit (not always fast-then-slow).
- D4 never longer than 1 bar · D0 after every hero hit · ≤ D1 while copy is read · half-time grid above ~140 BPM.
- **Complementary density:** busy music (16th hats, arps) → calmer picture; slow picture over fast music gives
  gravity. In melodic passages cut on melody notes, or not at all [7].
- **Switch what drives the cut** between sections: metric (clock), rhythmic (motion in frame), tonal (feeling),
  intellectual (idea) (Eisenstein [11]).
- Every full-frame luminance flip counts toward WCAG 2.3.1: ≤ 3 per second [15].

## 6. Arc, energy, openings, endings

Energy layers (practice; the section `energy` the composer and the picture read, 0-4): **0** drone/pad, a solo motif
fragment · **1** + light percussion, filtered, bass absent or held · **2** + kick and backbeat, bass, chords · **3** +
full drums, lead, counter-line, wider stereo · **4** + extra percussion, lead octave doubling, maximum brightness (the
picture reads 4 as 3). Move on phrase boundaries; signal an upshift with a 1-2 bar riser or fill (not every time);
downshift with a filter close, hard stop or tape stop.

Pick one arc on purpose. The flat curve `0·2·2·2·2·3·0` is a re-roll default (§10).

| Arc | Shape | Fits |
|---|---|---|
| A Cold-open drop | hook sound at 0 → gap → full drop at bar 2 → plateau with one variation → resolve | ads, social, showreels |
| B Slow burn | monotonic rise over ~85 % of the runtime; one hit at the very end | brand films, showreels |
| C Two-drop | drop at ~25 %, breakdown, bigger drop at ~70 %, short resolve | showreels, launches, social |
| D Reverse arc | open at full energy, strip to a solo motif for the name or product reveal | showreels, brand films |
| E Stop-start | music 1 bar, a second voice answers 1 bar, alternating; final bar together | social, ads |
| F Genre switch | first half one world → transformation (tape stop or riser) → second half another | ads, social, showreels |
| G Half-time pivot | same bpm; drums go half-time at the midpoint | ads, social, showreels |
| H Accelerando | density ramps at one tempo (8ths → 16ths), then settles | showreels, social |
| I Loop-perfect | 8 or 16 bars, no ending; the last bar prepares the first | loops |
| J Silence-led | mostly sparse sounds; the music arrives only in the last 6-8 s | brand films (wrong for ad hooks) |
| K Theme and variations | the motif in 3-4 instrumentations | showreels, brand films |

**Tension and release devices** (how to build them: `music-synthesis.md` §9; the picture partner is what you decide
here): noise riser → zoom, blur, brightness up · Shepard rise → endless zoom or tunnel · accelerating roll → D2 → D4
(WCAG) · filter build → desaturate or defocus, snap back on the drop · breakdown → negative space · pre-drop gap (a 16th
to a beat) → black, frozen or held frame · reverse swell → things gathering inward · tape stop → freeze, "power-down" ·
half-time switch → heavier, slower objects · fake drop (once at most) → reveal withheld one bar · key lift (+1/+2
semitones, a known cliché; use knowingly) → palette or light change · suspension resolving on the hit → asymmetry
locking symmetric · motif displaced a 16th per repeat → element drifting off-grid, snapping home.
- **Release rule:** a drop changes ≥ 3 dimensions at once (bass back, drums full, tonic arrives, and the picture
  changes colour, scale or space).
- **Build, break, drop:** dancers synced most with and rated highest the build-up and drop; drops gave the largest
  skin-conductance responses [17]. The biggest transition goes on the drop; strip elements in the break before it.
- **Expectation:** medium syncopation maximises pleasure and the urge to move [18]; emotion comes from expectations set
  and violated [14]. Establish the groove in 2 bars and break it once, at the reel's biggest moment.

**Openings** (first sound at 0.00-0.10 s): the motif solo and dry · a sound whose source is not yet visible ·
mid-phrase or mid-drop · a pickup putting the first downbeat hit at 0.4-0.6 s. Never a 2 s pad fade-in.

**Endings** (`audio.ending`, `ring` in `reel.config.mjs`): a resolved chord ringing ≥ 1.5 s into the reel's last
moment; the end card holds it. Place the final chord where the structure puts it, not by habit.

## 7. Sound worlds M01-M26

Tempo ranges are genre conventions [g] (signal at the edges). Kind as in §1; `real players` = compose it only as an
openly stylised version, or offer a produced track. Recipes and grids: `music-synthesis.md`. A world on no list is
welcome: name it, give it a kind and a tempo band, and use a short slug.

| ID | Sound world | BPM (felt) | Kind | Mood | Signature · trap |
|---|---|---|---|---|---|
| M01 | UK garage / 2-step | 130-136 | synth | slick, nocturnal | swung 16th hats (55-60 %), skipping kick, bent organ bass, m7/m9 stabs · a pitched-up vocal chop: make your own vowel chops |
| M02 | Drum & bass / liquid / jungle | 170-176 (85-88) | synth | velocity, euphoria | two-step break, sub with harmonics, reese · never the Amen break [21]: write your own break |
| M03 | Lo-fi hip hop / boom-bap | 70-90 | stylised | cosy, nostalgic | swung low-passed drums, FM keys; crackle and wow hide the synthesis · rain + crackle + the same ii-V loop |
| M04 | Ambient / drone | slow, sparse grid | synth | spacious, awe | detuned drones, slow filter, granular shimmer, sparse bells; picture events get swells (0.5-2 s attacks), not hits |
| M05 | Neo-classical / felt piano | 60-84 | real players | intimate, hopeful | additive piano is the weakest emulation; synthetic only as a music-box or celesta toy |
| M06 | Orchestral hybrid trailer | 120-140 | real players | epic, gravitas | atmosphere, pulse, a run of hits; saw "strings" read as General MIDI · a braam as default weight |
| M07 | Synthwave / outrun | 80-118 (128-140) | synth | retro-futurist | gated snare, octave saw bass, 16th arps · the stock synthwave kit: move tempo, drums and key |
| M08 | Hyperpop / digicore | 140-170 | synth | maximal, ironic | distorted 808s, pitched-up chops, bitcrushed bells, a drastic switch every 2-4 bars |
| M09 | Afrobeats | 100-120 | stylised | sunny, confident | clave-led percussion layers, melodic syncopated bass; plucked highlife guitar is the risky part · no "tribal" chants, no fake language |
| M10 | Amapiano | 110-115 | synth | smooth, hypnotic | log drum as pitched bass melody, swung shakers, restrained kick, long gradual layering |
| M11 | Funk / disco / nu-disco | 98-124 | stylised | joyful, groovy | ghost-note snare, octave or slap bass, string swoops; scratch guitar is the risky part · plain house four-on-the-floor |
| M12 | Minimal techno | 125-130 (hard 140-155) | synth | precise, hypnotic | slow development, 3- or 5-step loops against 16, one-note bass · plain house |
| M13 | Glitch / IDM | 90-170 | synth | clever, unstable | Euclidean rhythms, stutters, bitcrush; seeded randomness repeated in 2-bar cells so the ear can hold on |
| M14 | Jazz / brush kit | 60-90 ballad, 120-200 swing | real players | witty, classy | swing feel, walking bass and brushes betray synthesis fastest; synthetic only as a stated chip/FM combo |
| M15 | Folk / acoustic / stomp-clap | 88-104 | stylised | earnest, warm | stomp, clap, tambourine, plucked strum · the "corporate happy" kit; one famous stadium stomp pattern |
| M16 | City pop | 100-120 | stylised | nostalgic-bright | FM e-piano is native here; slap bass and brass stabs are the risky parts; maj7 and diminished colour |
| M17 | Chiptune | 120-160 | synth | playful, nerdy | pulse waves at 12.5/25/50 % duty, triangle bass, LFSR noise, arpeggios that fake chords |
| M18 | Jersey club | 130-140 | synth | bouncy, street | tresillo or shuffled triplet kicks, chopped vowels · your own squeak, never a famous sample |
| M19 | Footwork / juke | 150-165 | synth | frantic, virtuosic | sparse skipping kicks, triplet hats, 3-against-4 chops, full-time/half-time alternation |
| M20 | Reggaeton / dembow | 85-100 | synth | hot, festive | 3+3+2 snare over a four-on-the-floor kick, 808 sub, fills at phrase ends |
| M21 | Bossa nova / lounge | 120-140 (60-70 cut time) | stylised | breezy, elegant | bossa clave on the rim, maj7/9/13 colour; nylon comping is the risky part |
| M22 | Phonk / drift phonk | 130-145 | synth | dark, aggressive | cowbell melodies, distorted bass · no vocal samples; flash-sync within WCAG |
| M23 | Choir / vocal chops (synthetic) | any | stylised | uplifting | wordless formant voices as pads and chops; they sound robotic, so make that the point |
| M24 | Percussion ensemble / body | 90-130, polyrhythmic | stylised | physical, collective | 2:3:4 in one bar; chest, thigh and snap sounds · no costume clichés of any culture |
| M25 | Sound-design-only (foley-driven) | implied grid, 30-50 % silence | synth, ask the ear | tactile, honest | modal object sounds on an implied grid, one drone from the material |
| M26 | Found-sound music (product as instrument) | any | synth, ask the ear | witty, self-referential | the subject's own objects built as instruments (below), pitched into a scale as drums and melody · the stock kick and hat renamed "clunk" and "ratchet" |

**What makes a found-sound kit (M26; M25 by the same rules).** Tested runs built their "found" sounds from the drum
kit renamed: `kick` as a clunk or thud, `hat` as a ratchet or tick. Reviewers heard a drum machine. A found-sound kit
is designed from the subject's own objects instead:
1. **One object per voice, named.** Each voice is a thing from the subject's world, written in a comment with what it
   is made of, its size and how it is touched (a 300 × 210 mm aluminium lid, tapped by a fingertip near a corner).
2. **Built from the object, not from a drum.** Shape → mode ratios (`modal` `shape: 'plate' | 'ring' | 'tube'`,
   `bar`, `membrane`); size and material → pitch and decay (`plateHz`, `tubeHz`, `OBJECT_MATERIALS`); gesture →
   excitation (a tap: `modal` with `hard`; a drop: `rattle`; a drag, zip or ratchet: `scrape`; air: `shape: 'tube'`).
   Recipes: `music-synthesis.md` §7.
3. **The test for a renamed stock voice:** if the voice is `kick`, `snare`, `clap`, `hat`, `shaker` or `tick` with its
   default character, it is the drum kit, whatever its name. One may stay as the foreign element (§2), with a reason;
   at least three of the kit's voices come from object recipes.
4. **The objects give the music its notes.** Round each object's physical pitch into the scale, or take the key from
   the main object's pitch; its intervals can become the motif (§9 method 5).
5. **Ask the ear** (§1): the sounds are named after real objects; name them in the reply and ask.
6. **Name the pulse for the picture.** ReelMakeEasy finds kicks and snares by instrument or by name: call the object
   that plays the kick `kick_<object>` (`kick_crate`) and the backbeat `snare_<object>` or `clap_<object>`, or the
   reel's picture gets no kicks and no snares to pulse on.

## 8. Harmony and bass as decisions (no stock loops)

Mode → feel (practice, consistent with mode-valence findings [3]): Ionian bright, resolved (overused optimism) ·
Lydian wonder, floating (reveals) · Mixolydian casual-heroic, anthemic · Dorian cool, hopeful minor (groove worlds) ·
Aeolian serious, melancholic · Phrygian menace · harmonic minor drama, suspense · whole-tone dreamlike (transitions
only).

**Never a pentatonic "oriental" riff.** The major pentatonic played as a run of parallel fourths over a gong, a
"Chinese" or "Japanese" hook, a Phrygian-dominant snake-charmer line for "the Middle East", a harmonic-minor "exotic"
flourish: these are stereotypes, not music about the subject, and they read as mockery. The same for "tribal" drums,
chants, fake languages and any instrument used as a costume. A pentatonic *melody* inside a written harmony is fine
when the concept asks for it; a pentatonic cliché as the hook is not.

Write harmony from the reel, not from a list:
1. **Start from the motif** (§9): harmonise its notes, or hold a pedal and move one upper voice. A modal vamp is fine
   when written for this motif and changed at the reveal.
2. **Harmonic rhythm follows energy:** a chord per bar (energetic), per 2 bars (calm), per half-bar into a climax.
3. **One surprise chord**, at the reveal (a borrowed iv, a bVI, a secondary dominant). More than one is noise.
4. **End cadence by meaning:** plagal IV-I (warm) · V-I (definitive) · bVI-bVII-I (heroic) · Picardy third, a minor
   piece ending major (problem solved) · unresolved (a question, or a loop).
5. **Voicing (practice):** roots in E1-E2, no 3rds below ~C3, spread voicings, top voice moving by step; pads in
   200 Hz-2 kHz so UI-like voices own 2-6 kHz.
6. **Bass (practice)** answers the groove: offbeat roots or octave 8ths over four-on-the-floor, gap-filling bends in
   garage, kick-following glides in half-time, syncopated melody in Afro and amapiano, pedal in ambient. Kick and bass
   are never both long on one downbeat unless ducked. Give every bass harmonics so phone speakers can play it.

Stock loops are re-roll defaults, not suggestions: I-V-vi-IV and its rotations · I-vi-IV-V · i-VI-III-VII ·
i-VI-VII-V · the lo-fi ii-V loop. Using one needs a written reason and a twist.

## 9. Motif and sonic logo

Derive the motif; never invent it from nothing. Pick one method and write why:
1. **Cryptogram:** letters A-G are pitch names; map the others by alphabet index mod 7 onto scale degrees [22]
   (`cryptogram('<word>', 7)` in `tools/audio/theory.mjs`).
2. **Speech rhythm:** the stress pattern of the name or line becomes the rhythm (stressed = long or accented).
3. **Numbers:** a version or model number becomes an interval or a note count.
4. **Mark geometry → contour:** rising diagonal → rising line · circle → returns to its first note · zig-zag →
   alternating leaps.
5. **Product sound → motif:** resynthesize the product's notification or mechanism and pitch it into 3-5 notes.

Melody rules (practice): 3-5 notes within an octave + 3rd · mostly stepwise with one leap, then a step back the other
way · keep the rhythm and vary pitch, or the reverse · questions end off the tonic, answers on it · the motif's peak
note meets a visual peak.

**The motif drives the picture.** Every motif note becomes a melody accent (`melody(0.8)`) in the reel: state it where
words, cards or icons should pop, one element per note.

**Motif as story:** problem = minor, low, broken rhythm → product wakes = same notes, major, bright → proof = motif as
bass ostinato → scale = motif in canon → resolve = full motif harmonised. Tools: augmentation, diminution, inversion,
retrograde (the composer's `aug dim invert retro shift:n`), reharmonisation, modal shift.

**Sonic logo** = the motif's final statement, 2-5 notes over ~1-3 s [23] (vendor, signal). Plant it in the first
3 s and resolve it on the end card on the tonic or the 3rd. Sonic cues rank among the strongest distinctive brand
assets, and bespoke cues beat borrowed popular songs [24] (secondary summaries, signal). No 4+ note run matching a
known jingle or famous sonic logo.

## 10. Originality checks

**Re-roll defaults** (habits of agents writing music). Each one you keep needs a one-line reason in the plan; if three
or more match, change the plan until at most two remain: 120 or 128 BPM · 88, 96 or 112 BPM · M10 near 112, M20 near
96 or M26 near 88 · a found-sound kit made of renamed drum voices (§7) · four-on-the-floor as the main groove · a stock
instrument set (pluck + saw pad; 808 + hat rolls; toms + saw ostinato + braam; gated snare + octave bass) · keys D
major, C minor, D minor, A minor · a stock loop (§8) · energy curve `0·2·2·2·2·3·0` · the first big hit at 2.0 s · a
gap one 16th before every hit · a riser and a whoosh into every transition · a plain fade instead of a designed ending
· the "corporate happy" kit (ukulele, claps, glockenspiel, whistling) · digital/pure blips as the material palette ·
the worked example's world, tempo and key (UK garage, 136 BPM, F# dorian) for an unrelated reel.

**Never:** a pentatonic "oriental" riff or any ethnic cliché (§8) · "in the style of" an artist, a song or a film ·
a famous drum break, riff or sonic logo.

**Anti-generic moves** (full list in `music-synthesis.md` §15): change something every 2 bars · one polymetric element ·
swing decided per voice · ≤ 1 ear-candy device per phrase · subtract a layer for a bar instead of adding one.

**Reference transformation rule.** When the user names a reference (a video or a track they like), keep **at most 2 of
these 7**: sound world, tempo band, key/mode, lead timbre, drum pattern, arc, sync device. Change the rest. Then: no 4+
note sequence with the same pitches *and* rhythm · no recreated signature sound or sonic logo · no soundalike voice.
Soundalikes are a legal risk, not a loophole (*Midler v. Ford* [19]; the "Blurred Lines" verdict effectively
protected a "feel" [20]).

## 11. What to write down

In `reel/plan.md`, a `## Music` section before the scenes (fill every line):
```
sonic concept:    The world of this reel sounds like ... because ...   (stylised: "a <...> version of <idiom>, because ...")
columns:          world M.. (or slug) · foreign element ... · arc ... · sync device ...
tempo:            ... BPM (style range ...-...) · felt ... · groove ... · bars ... = round(length × bpm / 240)
material palette: ...                      relation: ... (+ counterpoint moment at bar ...)
motif:            method ... · degrees/rhythm ... · planted at bar ... · sonic logo at bar ...
harmony:          key ... mode ... · harmonic rhythm ... · surprise chord at bar ... · end cadence ...
sections:         name bars energy, ... (they add up to the bar count)
re-roll defaults: matched ... (reason for each)
ask the ear:      the voices that imitate a voice, an instrument or an object (§1), or none
```
Then write `music.mjs` (key, mode, voices, grids per section, progression, motif, sections with energy; `step(ctx)`
only where data can't say it) and set `bpm` in `reel.config.mjs`. Build and measure with `music-synthesis.md`.

## Sources

[g] Genre tempo conventions: Ableton https://learningmusic.ableton.com/make-beats/tempo-and-genre.html · Digital DJ Pool
https://digitaldjpool.com/blog/dj-bpm-guide/ · Orphiq https://orphiq.com/resources/bpm-tempo-guide · Wikipedia genre
articles (Afrobeats, Jersey club, Hyperpop, Dembow, Footwork, Phonk, Minimal techno, Synthwave, City pop, Chiptune).
[1] Takehana, Uehara & Sakaguchi 2019, PLOS One: https://pmc.ncbi.nlm.nih.gov/articles/PMC6711538/ · [2] McKinney & Moelants 2006 (cites Moelants 2002): https://cspeech.ucd.ie/rppw/rppw10/mckinney/abstract.html
[3] Eerola, Friberg & Bresin 2013, Frontiers in Psychology: https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2013.00487/full
[4] Cutting et al. 2011, i-Perception: https://pmc.ncbi.nlm.nih.gov/articles/PMC3485803/ · Cutting, DeLong & Nothelfer 2010: https://www.sciencedaily.com/releases/2010/02/100223121435.htm
[5] MacLachlan & Logan, TV commercial shot length (WARC): https://www.warc.com/Content/421e1376-baa5-472f-aa9d-adc58bea5146 · [6] Brysbaert 2019 reading rate (BPS): https://www.bps.org.uk/research-digest/most-comprehensive-review-date-finds-average-persons-reading-speed-slower
[7] Lemon, Orlando Wood/System1/IPA (~200 ads from a testing firm; industry evidence): https://lbbonline.com/news/ipa-publishes-lemon-a-repair-manual-to-reverse-the-crisis-in-creative-effectiveness
[8] Murch, Rule of Six: https://nofilmschool.com/2016/11/6-rules-good-cutting-according-oscar-winning-editor-walter-murch · [9] Lipscomb: https://auditory.org/postings/1998/35.html · Rogers & Gibson, ICMPC 2012: https://eprints.hud.ac.uk/14946/1/ICMPC2012_AndrewRogers.pdf
[10] Mickey Mousing: https://en.wikipedia.org/wiki/Mickey_Mousing · [11] Eisenstein's methods: https://portfolio.newschool.edu/lune/2016/11/03/montage-methods-in-sergei-eisensteins-article
[12] ITU-R BT.1359 via TV Technology: https://www.tvtechnology.com/opinions/av-synchronization-how-bad-is-bad · [13] Chion, synchresis: https://www.filmsound.org/chion/sync.htm
[14] Huron, ITPRA (Sweet Anticipation review): https://leonardo.info/reviews_archive/july2007/sweet_zilberg.html · [15] WCAG 2.3.1: https://www.w3.org/WAI/WCAG21/Understanding/three-flashes-or-below-threshold.html
[16] Practitioner: https://global.sumaart.com/share/650.html · https://designingsound.org/2014/06/05/the-negative-space-of-sound/ · [17] Solberg & Jensenius 2017: https://doaj.org/article/a06c41eeed7e4b52a9098bef18260a50
[18] Witek et al. 2014, PLOS One: https://doi.org/10.1371/journal.pone.0094446 · [19] Midler v. Ford (9th Cir. 1988): https://en.wikipedia.org/wiki/Midler_v._Ford_Motor_Co.
[20] Williams v. Bridgeport ("Blurred Lines"): https://en.wikipedia.org/wiki/Pharrell_Williams_v._Bridgeport_Music · [21] Amen break: https://en.wikipedia.org/wiki/Amen_break
[22] Musical cryptogram: https://en.wikipedia.org/wiki/Musical_cryptogram · [23] HEARDIS, sound logo (vendor): https://www.heardis.com/services/sound-logo/
[24] Ipsos, distinctive brand assets (secondary summaries of a 2020 meta-analysis): https://www.ipsos.com/en-us/knowledge/media-brand-communication/power-you-why-distinctive-brand-assets-are-driving-force-creative-effectiveness
