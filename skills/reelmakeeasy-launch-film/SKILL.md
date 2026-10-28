---
name: reelmakeeasy-launch-film
description: The owner's quality bar for a Motion Reel, measured from a 60 s launch film they picked; its story arc, music arc, scene types, transitions, layout and pacing, scaled to 15, 30 and 60 s. Use in every Motion Reel chat (a product launch, or a motion reel meant to look like a premium launch film) before writing the music or the plan, and when a reel looks like a slideshow, joins scenes with plain slides, or its music has no stops or drop.
---

# The launch film

The owner set one 60 s launch film as the bar for every Motion Reel. This skill is what it does, measured frame by frame and on its audio (`references/reference-breakdown.md` has the second-by-second breakdown). Take its method, never its content: the subject's own product, words and colours go on screen, never the reference's.

What makes it work, in one line each:
- **A story, not a feature list.** A problem, a question in silence, the product revealed on the drop, what it does in eight one-beat words, the product working, proof in live numbers, a manifesto, a slam, the logo in silence, the final hit.
- **The music is the editor.** 120 BPM, a major key, the kick at full level from the first frame, a stop of silence before the drop and another before the final hit. Every cut sits on a beat; every act starts on a phrase.
- **Every scene is a world.** Its own ground (dark, light or a colour fill), its own type and its own trick, but one shared mark (a dot, the logo) carries the eye from one world into the next.
- **Nothing is ever still and nothing is a plain slide.** Every scene has a live counter or a building UI, and every join is designed: a collapse to a dot, an explosion, a zoom through, a shape match, a whip.

## 1. The arc

The reference, 60 s at 120 BPM (30 bars, 2 s a bar). Bars from 0:

| # | Act | Bars | Music | Picture |
|---|---|---|---|---|
| 1 | Problem | 0-2 | the groove at full level from 0.00 | a two-line headline on the left ("Opening a store / still takes weeks."), a big live counter under it that steps on the beat (DAY 01 → 23), the product's chores piling up on the right as UI cards in a loose stack |
| 2 | Question | 2-3 | highs rise | the field empties; one short question in an italic serif, typed in the centre ("What if you could just say it?") |
| 3 | Stop | the last 3 beats of bar 3 | silence (about −32 LUFS) | the product's input appears; the user's sentence types into it letter by letter; the field shrinks into a glowing dot |
| 4 | Drop, reveal | 4-5 | the drop, full band | the dot bursts: a white flash, a light-streak explosion, particles that swirl into the logo; "Introducing / Name." The logo then rushes at the camera (zoom through) |
| 5 | What it does | 6-7 | full | eight words, **one a beat**, each a full-frame world that acts the word out: a heavy sans on violet, a serif typed with a cursor on cream, a word between floating shapes on pink, the word as a repeating pattern on yellow, a mono word in a terminal with "✓ 140 regions configured", a gradient word on black |
| 6 | It works | 8-10 | a riser across it | a light world: the product's UI in a 3D tilt; its wireframe draws, the content fills in section by section, the tilt flattens to face the camera as it completes; a toast slides in ("New order #1001") |
| 7 | Breather | 11-12 | thinner, a break | a chat panel; a request types; the answer types |
| 8 | Output | 13 | full | the answer's results fly out as cards (a chart, an email, a lookbook, a code) and settle into a grid, then collapse into a glow that becomes the logo |
| 9 | Proof | 14-23 | full, a hit on bar 16 | three proof scenes, each with one headline and one live number: the logo with orbiting connected apps ("Every system / already on."); the logo grows into a circle that becomes a globe, arcs fly between cities, orders count 0 → 1,284; a flash into a light world, a gauge sweeps 18 → 96 %; a burst of small shop cards becomes a wall of stores, 128,450 counting |
| 10 | Manifesto | 24-25 | full | a whip into a dark tunnel of light streaks; three short phrases, one a bar ("From a sentence / to a storefront / to your first sale.") |
| 11 | Slam | 26 | full, on every beat | the camera dives into the tunnel's end, a dot that fills the frame in colour; one word a beat on alternating colour fills: OPEN / FOR / BUSINESS / TODAY. |
| 12 | Stop, logo | 27-28 | silence, a held pad | coloured brush strokes swoop in on a light ground and assemble the logo; the wordmark types beside it; the tagline fades up |
| 13 | Final hit | 29 | the last chord, ringing | the availability line lands with one soft ring; it holds while the chord rings out |

**Scale it to the reel's length.** Keep the order and the two stops; drop or merge middle acts. Bars at 120 BPM:

| Length | Bars | The acts |
|---|---|---|
| 15 s | 8 (16 s) | problem 1 · question + stop 1 (the stop is its last 3 beats) · reveal 1 · what it does 1 (4 words) · it works 2 · slam 0.5 + stop 0.5 · final hit 1 |
| 30 s | 15 | problem 2 · question + stop 1 · reveal 2 · what it does 2 (8 words) · it works 3 · proof 2 (one scene, one number) · slam 1 · stop, logo 1 · final hit 1 |
| 60 s | 30 | all thirteen, as in the table above |

A `showreel` (pure show-off motion) keeps the music arc, the joins, the worlds and the pacing below, and swaps the story: open on the strongest motion, the stop before the drop, the staccato and the slam as type, the logo in silence at the end.

## 2. The music arc

Compose it with `reelmakeeasy-music-composer`, recipe E (the launch film: D major, 120 BPM, 15 bars, measured and passing), or another recipe shaped the same way:
- **120 BPM** (115 to 128), a major key (D major in the reference), four on the floor. 2 s bars make the arithmetic easy: a beat is 0.5 s.
- **Full level from 0.00.** No fade-in, no slow intro: the kick and the bass are there on the first frame (about −14 LUFS from the start).
- **Stop 1:** the last 3 beats before the drop are near-silent (a section `{ name: 'stop', beats: 3, energy: 0 }` with only a quiet pad held). The picture's quietest, most personal moment goes here: the prompt typing, the product being asked.
- **The drop** on a downbeat: the picture's biggest change of the reel (flash, explosion, reveal).
- **A riser** into the section where the product works (`fx: ['riser']`), and one breather (energy 2) in a 60 s reel.
- **Stop 2:** one bar of near-silence before the final hit (`energy: 0`, a held pad): the logo assembles in it.
- **The final hit** on the last bar's downbeat: the tonic chord, ringing 1.5 s or more under the end card.
- The music map then has sections named for the acts: plan the scenes on them.

## 3. The joins

Every join is designed; none is a plain slide or a crossfade. The reference's joins, and when to use each:

| Join | How it moves | Use it |
|---|---|---|
| Collapse to a dot | the scene shrinks into one glowing dot (the input field, a card) on the stop | into the drop |
| Burst | the dot swells, a white flash fills the whole frame for 2-3 frames, then dense light streaks rush out from the centre (hyperspace), then a thick particle cloud: a few sparse dots read as weak | the drop, once |
| Particles to a mark | particles swirl along a spiral and settle into the logo | the reveal |
| Zoom through | the logo or a dot rushes at the camera (other elements gone first) until it fills the whole frame with its colour in about half a beat; the next world is that colour | from a reveal into the staccato, from the tunnel into the slam |
| Hard cut on the beat, new colour | the next word's world simply replaces the last, on the beat | the staccato and the slam |
| Shape match | the last scene's main shape becomes the next one's (the logo's arch grows into a ring, the ring is the globe's rim; a white sun becomes a gauge's dial) | between proof scenes |
| Collapse to a glow | cards or UI fall into one bright glow, which becomes the next scene's mark | after a busy scene |
| Whip | a fast motion-blurred pan or stretch (a card slides off with smear, the frame goes white) into the next world | into a new section |
| Fly out, fly in | the next scene's parts fly out of the current one (the chat's answer bursts into cards) | the output act |
| Strokes assemble | three or four big coloured strokes swoop in from the frame's edges on long curves across the whole frame and lock into the logo at the centre | the end, in the stop |

Joins happen on the scenes' own grounds: never dim the frame to a flat grey with a small shape in it (a dead frame), and never leave a frame where one small mark sits alone on an empty ground, except the end card's first beat.

Use depth (perspective, `translateZ`, a tilted UI) for two or three of these at most: the tilted UI building itself, the cards flying out, the tunnel. Everything else faces the camera.

## 4. Each scene

- **Scale: fill the frame.** The reference's UI is big and dense: on 16:9 the product's cards, phone or site own the right two thirds from top to bottom (a phone 80-90% of the frame's height, a card stack filling its half), the headline is about 5% of the height a line and its number about 10%. A small phone or a few small cards in a corner with an empty lower half is the first thing that makes a reel look cheaper than the reference. Sizes that work at 1920x1080 (scale with the frame): headline lines about 56 px, a live number about 160 px; a card stack of cards about 520 px wide spanning y 120-960 on the right 60%; the product's screen (a tablet or a big tilted window) about 1100 px wide; a ring, gauge or globe about 800 px across; the end card's mark and wordmark one centred block about 900 px wide (cap height about 140 px), the tagline about 44 px under it; the logo's strokes 24-30 px thick, each sweeping across at least half the frame. Write the sizes in the plan: a size in percent is easy to misread.
- **Layout (16:9):** the headline on the left third, two lines, the first light and grey, the second bold in the accent colour ("Opening a store" / **"still takes weeks."**); the visual on the right two thirds; a live number under the headline with a small mono label above it (DAY, ORDERS TODAY, STORES OPENED). Those small labels belong to the number they name; they are not HUD chrome. 9:16: the headline on top, the visual filling the middle, the number low but above the bottom 15%.
- **One live thing in every scene:** a counter stepping on the beat, a UI building, arcs flying, a gauge sweeping, text typing. A counter counts up with easing and lands on its value on a beat; a sentence types at about 20 characters a second with a cursor.
- **Worlds alternate:** dark (ink with soft violet and coral glows), light (warm cream with soft colour clouds) and full colour fills (violet, coral, yellow, pink), never two neighbours alike in the staccato. One accent colour carries the second headline line and the counters all film long.
- **Type:** a clean grotesk for headlines (light and bold of one family), a condensed heavy sans for the one-word slams, an italic serif for the question and one staccato word, a mono for labels and code. Three or four families, each with one job.
- **The product's own UI, rebuilt in code:** input fields, cards, a chat, a site preview, toasts, charts. They are the content; never empty boxes.
- **The shared mark:** the dot of the stop, the logo of the reveal, the circle of the globe and the dot at the tunnel's end are one idea. Carry it through the reel and end on it.

## 5. Pacing

- One idea a bar (2 s at 120 BPM), two bars at most; the staccato and the slam one a beat.
- A new act starts on a phrase (every 2 or 4 bars); cuts inside an act sit on beats.
- Each scene lands its main element on a beat and keeps a second motion going (the counter, a slow camera push, particles).
- The only holds are the final hit's ring-out and the stops, and even in a stop something moves (the typing, the strokes).

## 6. Before you ask to build

Check the plan against this list and say in the plan how each one is met:
- [ ] The arc for the reel's length (§1), each act on its bars.
- [ ] The music has full level from 0.00, the stop before the drop, the drop on a downbeat, stop 2 and the final hit (§2).
- [ ] Every join named from §3; no plain slide, no crossfade, no fade to black; depth on at most three.
- [ ] Every scene has its live thing and its world (dark, light or colour), and neighbours differ.
- [ ] The words: one headline (two lines) per scene at most, the staccato words, the slam, the end line. Nothing else.
- [ ] Scale: the product's UI owns the right two thirds top to bottom; no scene is a small element in a corner.
- [ ] The end card: the mark and the wordmark centred as one block (about a quarter of the frame's width), the tagline under it, one soft ring on the final hit.
- [ ] The shared mark is named and carried to the end.
