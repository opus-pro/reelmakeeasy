---
name: reelmakeeasy-beat-loop
description: Write a loop short for ReelMakeEasy, a looping vertical video (16–32 s) of 4-second AI clips that each run a 1-2-3-4 attention beat (hit, hit, freeze, fast cut), with narration, word-level captions, fact stamps and no music, then start it with make_beat_loop. Use for fun facts, explainers, product moments, or any short that needs a visual stimulus every 2–3 seconds and should replay seamlessly.
---

# Beat-Loop Shorts

A **beat-loop short** is a vertical video made of **N clips × 4 seconds**. Every clip
plays one bar of four beats, and the last clip lands back on the first frame, so the
video replays as a seamless loop.

```
clip:   |---- 1 ----|---- 2 ----|---- 3 ----|---- 4 ----|---- 1 ----| ...
beat:      HIT         HIT        FREEZE       CUT         HIT
time:   0s          1s          2s          3s          4s
```

- **Beats 1–2 (0–2s), HIT:** something big and sudden happens in this scene.
- **Beat 3 (2–3s), FREEZE:** the motion stops. The viewer reads the image and hears the line.
- **Beat 4 (3–4s), CUT:** a fast camera move carries the viewer into the next scene.

The viewer gets a fresh stimulus every 2–3 seconds: hit at 0s, cut at 3s, new hit at 4s.

This recipe was developed and measured on MiniMax Hailuo H3 (first+last-frame mode).
It should transfer to any image-to-video model that takes a first frame, a last frame
and a text prompt. In ReelMakeEasy you write the storyboard and ReelMakeEasy does the rest:
rendering the clips in order (§5), the edit (§8) and QA with re-rolls (§9) aren't
repeated here. "How to make one here", at the end, says what to do.

---

## 1. What the pipeline needs

| stage | capability needed |
|---|---|
| Keyframes | text-to-image + image-to-image (style reference), vertical 9:16 |
| Clips | image-to-video with **first frame + last frame** anchors, ~4s duration |
| Narration | TTS with a fixed voice (deterministic per voice) |
| Word timing | forced alignment or ASR word timestamps (with a fallback, see §7) |
| Edit | per-segment retime, concat, audio mix, PNG overlays (any NLE or ffmpeg) |

Length options: 16s = 4 clips, 20s = 5, **24s = 6**, 28s = 7, 32s = 8.
Clip count = duration ÷ 4. You need **clip count + 1** keyframes; the last one is a copy
of the first.

---

## 2. Story structure

| clip | role | example (fun fact, 24s) |
|---|---|---|
| 1 | **Hook**: the surprising claim, all key players on screen | "Cleopatra lived closer to the Moon landing than to the pyramids." |
| 2…N-1 | **Proof**: one fact per clip, in order | pyramid c. 2560 BC → Cleopatra 69 BC → Moon landing 1969 → the timeline |
| N | **Kicker**: the twist or takeaway, then cut back to the hook | "Ancient Egypt was so old, it had its own ancient history." |

Rules:
- **One idea per clip.** If a fact needs two sentences, it needs two clips.
- **The hook frame shows the whole cast** (all the subjects the story will visit), so
  looping back to it at the end makes sense visually.
- **The kicker's last line should make the hook line worth hearing again.** The loop is
  the rewatch prompt.
- Verify every fact before writing frames. Put the sourced numbers in a comment on the storyboard.

---

## 3. Keyframes (the storyboard images)

Keyframe `f(k)` is the **opening image of clip k+1** and the **landing image of clip k**.
Clip k animates `f(k-1) → f(k)`.

```
f0 ──clip1──▶ f1 ──clip2──▶ f2 ── … ──clipN──▶ fN (= copy of f0, closes the loop)
```

Rules (each one learned from a failed render):

1. **Consecutive keyframes must be different shots**: a new subject, scale or location.
   If f(k) and f(k+1) share a framing, there is nothing for beat 4 to travel to. The
   model then fires the event early and beat 4 sits empty.
2. **Keep one look across all frames.** Generate f0 from text. Generate every later
   frame image-to-image **from the previous frame**, with the instruction: "Use the provided image only as the reference for visual style, color grade, lens and lighting; create this new shot: …". Append the same STYLE string to every prompt.
3. **No text in any keyframe.** Image models invent labels (we got "HISTORICAL MYSTERY
   1922" on a Cleopatra frame), and video models garble any text they're given ("1969"
   became "1.69"). Add "No text, no labels, no numbers anywhere in this frame" to every
   keyframe prompt. Facts go on screen in the edit (§7).
4. **Loop:** fN is a byte-for-byte copy of f0. Don't regenerate it.
5. Review all keyframes as a contact sheet before rendering any video. Keyframes are
   cheap; video renders are not.

---

## 4. The clip prompt

### Template

Fill the `{…}` slots per clip. Keep the wording otherwise **verbatim**. Every phrase is
there because removing it caused a measurable failure.

```
A 4-second vertical short-form clip filmed as ONE continuous shot with no edits. Rhythm 1-2-3-4: two beats of explosive action, one beat of frozen stillness, one beat of fast transition.
0.0s-2.0s [{HIT_CAMERA}]: {HIT} The action starts instantly on the first frame with no build-up: big, sudden, fast motion that fills the frame, motion blur, high energy.
2.0s-3.0s, same shot, same camera angle, no cut, nothing new appears: the motion freezes. {FREEZE} The camera stops dead where the action left it; a held breath in slow motion.
3.0s-4.0s [{CUT_CAMERA}]: {CUT} A sharp, fast camera move with heavy motion blur that arrives on the final frame at 4.0s.
Rules: exactly one change of scene, and only in the last second, through the fast camera move. Stay in the opening scene until 3.0s. Never dissolve, crossfade or morph between the two scenes. No on-screen text, letters, numbers, labels, captions, logos or watermarks anywhere, at any moment.

Style: {STYLE}

Audio: diegetic sound effects only, with a hard impact on the hit and a whoosh on the cut. No music, no narration, no voice-over, no speech, no singing.

non_diegetic_music: N/A
```

Request parameters:
- `first_frame` = clip 1: f0. Clips 2…N: **the actual last frame of the previous rendered clip** (ReelMakeEasy does this).
- `last_frame` = f(k), the next scene's opening keyframe.
- `duration` = 4s. Use the model's native mid resolution (ReelMakeEasy does this). Turn off any prompt rewriting or expansion.

### Writing HIT, FREEZE and CUT

| slot | write | don't write | why |
|---|---|---|---|
| **HIT** | One violent, visible action on the subject that's already in frame: "slams", "erupts", "shatters", "bursts toward the camera". Anchor the angle: "From the same top-down angle, …" | Slow verbs ("drifts", "begins to"). Anything the opening angle can't show. | If the opening angle can't show the action, the model hard-cuts to an angle that can. |
| **FREEZE** | The hit's motion **freezing** or decaying, same subject, same framing: "The cutouts freeze, edges lifted off the page." "The ripples freeze." | Any new event: "the tamper lifts away", "the grounds settle", "a glow appears". Anything outside the framing: "the field goes still" in a close-up. | A new event in beat 3 makes the model cut to a new angle at about 2.0s. This was the most common failure. |
| **CUT** | One physical camera move that could plausibly travel from this framing into the next keyframe: "dives straight down through the grinder into the basket below", "whips up past the peak into the sky". | "Transitions to", "fades to", "becomes". | Abstract transitions turn into slow morphs. |

### Camera vocabulary (bracketed commands)

Put a camera command **only** on the HIT and CUT lines. **Never on the FREEZE line:**
the model treats each timecoded block that has its own camera command as a **new
shot** and inserts a hard cut at exactly 2.0s.

| use for HIT | use for CUT (pick the one that travels to the next frame) |
|---|---|
| `Push in` (default punch), `Shake` (impacts, explosions), `Zoom in` (reveal detail) | `Push in` / `Zoom in` (dive *into* something), `Pull out` (reveal a wider world, a timeline, a container), `Tilt up` / `Tilt down` (sky ↔ ground, up/down through a surface), `Pan left` / `Pan right` (whip-pan to a neighbouring subject) |

The model reads prompt timecodes as **absolute seconds**: "2.0s" means 2.0 seconds into
the render, not 50% of it.

---

## 6. Narration

- **8–10 words per clip** (≈2.2–3.4s of speech). Speech must end by about 3.6s, before the
  cut. If a line runs long, speed the TTS up (max about 1.3×), else trim the words.
- Start each line **0.15s into its clip**, so the first word lands on the hit.
- Use one fixed voice for the whole video. Write numbers the way they should be
  **spoken** ("twenty-five sixty B.C.", "two thousand"). The on-screen spelling is
  separate (§7).
- Mix: clip SFX at about 35% under the voice, then loudness-normalize the master to
  **−14 LUFS** (true peak −1.5 dB).
- **No background music.** The prose "No music" line alone did not stop the model from
  adding a music bed: 5 of 6 renders still had one. Adding the structured line
  `non_diegetic_music: N/A` as the **last line of the prompt** brought that to 0 of 6.
  Add music in the edit if you want it.

---

## 7. Text on screen (captions and facts)

**Never let the video model draw text.** All text is overlaid in the edit, which keeps
it exact.

**Captions:**
- Show 1–3 words at a time and break after punctuation. Each chunk stays up until the
  next one, never past its own clip.
- A loop starts in the Punch caption style: big white capitals, with one highlighted
  word per caption (the longest non-filler word), lit for the whole caption.
- ReelMakeEasy draws the captions the same way as every other video's. The user picks their
  style, highlight colour, height and size in the app; you never set them.
- Each clip has two texts: `narration` (what's spoken) and `caption` (what's shown,
  e.g. "2560 BC").

**Fact stamps:** a short exact label per clip (e.g. "c. 2560 BC", "1969 AD"),
top-right, from 0.3s until 3.0s of the clip. That's on screen through hit and freeze,
gone before the cut.

**Word timing:**
- Use ASR or forced-alignment timestamps only when the word count matches the caption
  and every word has a real duration (≥ 0.06s). ASR sometimes squashes the end of a
  line to zero length.
- Otherwise fall back:
  1. Split the caption at its punctuation.
  2. Detect the pauses in the TTS audio (silence ≥ 0.12s at −35 dB).
  3. If the pause count matches the punctuation breaks, give each phrase its own speech
     segment. Inside a phrase, spread the words by **spoken** length (a number with d
     digits ≈ 4d+3 characters; "BC"/"AD" ≈ 5).

---

## 10. Storyboard schema (hand this to the writing bot)

```json
{
  "title": "Cleopatra vs the Moon landing",
  "duration_s": 24,
  "voice": "warm female narrator, fixed voice id",
  "style": "Editorial explainer collage: textured off-white newsprint paper background, black-and-white halftone archival photo cutouts with thin white sticker borders and soft drop shadows, bold yellow highlighter strokes, hand-drawn red marker circles and arrows, torn paper edges, subtle film grain, flat top-down lighting, vertical 9:16 composition, clean modern graphic design.",
  "accent": "#FFE500",
  "sources": "Great Pyramid c. 2560 BC; Cleopatra VII born 69 BC; Apollo 11 landed 1969 AD",
  "keyframes": [
    { "id": "f0", "prompt": "Hook: a large halftone cutout of a classical marble bust of Cleopatra in the center, yellow highlighter swoosh behind her head, a small Apollo astronaut cutout upper right, a small Great Pyramid cutout lower left, a red marker question mark. No text, no labels, no numbers anywhere in this frame." },
    { "id": "f1", "prompt": "NEW SHOT: a large halftone Great Pyramid cutout filling the frame, a red marker arrow pointing at it, yellow highlighter across the sand. No text, no labels, no numbers anywhere in this frame." },
    "…",
    { "id": "f6", "same_as": "f0" }
  ],
  "clips": [
    {
      "id": "s1",
      "hit_camera": "Push in",
      "hit": "The paper cutouts slam into place: the astronaut and the pyramid snap in from opposite corners and a yellow highlighter stroke swipes fast behind Cleopatra's head.",
      "freeze": "The cutouts freeze, their paper edges lifted slightly off the page.",
      "cut_camera": "Zoom in",
      "cut": "The camera zooms fast into the small pyramid cutout until it fills the whole frame.",
      "narration": "Cleopatra lived closer to the Moon landing than to the pyramids.",
      "caption": null,
      "stamp": null
    },
    {
      "id": "s2",
      "hit_camera": "Push in",
      "hit": "The pyramid photo's stone blocks stack upward fast, course by course, and a red marker arrow draws itself toward the pyramid.",
      "freeze": "The finished pyramid and the red arrow freeze in place on the paper.",
      "cut_camera": "Pull out",
      "cut": "The camera pulls back fast and drops down to a tiny Cleopatra cutout standing at the foot of the pyramid.",
      "narration": "The Great Pyramid was finished around twenty-five sixty B.C.",
      "caption": "The Great Pyramid was finished around 2560 BC.",
      "stamp": "c. 2560 BC"
    }
  ]
}
```

### Style presets that worked

- **Explainer collage:** the style string above. Hits = cutouts slam or slide in, marker circles scribble, highlighter swipes, paper crumbles. Cuts = zoom into a cutout, pull out to a timeline, whip-pan along a paper strip. (Use the look only; never a publisher's name or logo.)
- **Cinematic nature:** "Photoreal cinematic nature documentary, dramatic storm lighting, deep blue-violet shadows with electric white-violet highlights, anamorphic lens, shallow depth of field, vertical 9:16 composition, rich contrast, film grain." Hits = eruptions, strikes, impacts with `Shake`. Cuts = dive into or out of clouds, whip back through a window.
- **Macro product:** "Photoreal macro product cinematography, warm morning window light, dark walnut and brushed chrome, rich browns with golden highlights, shallow depth of field, vertical 9:16 composition, crisp commercial look." Hits = slam, burst, pour, shatter. Cuts = crash-zoom into the cup, whip-pan to the machine, drop down through the grinder.

---

## How to make one here

You write the storyboard. ReelMakeEasy makes the voice, the keyframes and the clips (in order,
each from the last frame of the one before), checks every clip and re-rolls a failed one,
then times the captions, adds the stamps and mixes the sound.

1. **Settle the idea and the length** with the user: 16, 20, 24 (the default), 28 or 32 seconds.
   Check every fact and keep the sources.
2. **Write the storyboard JSON** (§10). ReelMakeEasy checks it and lists every problem at once:
   - `duration_s` is 16, 20, 24, 28 or 32, with one clip per
     4 seconds and as many keyframes, or one more ending with
     `{"id": "fN", "same_as": "f0"}`.
   - `hit_camera` is one of Push in, Shake, Zoom in;
     `cut_camera` one of Push in, Zoom in, Pull out, Tilt up, Tilt down, Pan left, Pan right.
   - `freeze` has no camera words; `cut` is one physical camera move, never "transitions
     to", "fades to", "becomes", "morphs", "dissolves" or "crossfades".
   - `narration` is 6–12 words (8–10 fit best), with numbers
     written as spoken words; the digits go in `caption` or `stamp`. Keep lines easy to
     say: quotes, colons and dashes add pauses, and long words take longer. The check
     warns about a line that likely won't fit.
   - `stamp` is at most 16 characters, or null; `sources` says where the facts
     come from. `accent` is optional: a colour like `#FFE500` that suits the topic.
     ReelMakeEasy offers it to the user only as a suggestion for the captions' highlight colour;
     it is never applied on its own.
   - Keyframe prompts describe the shot only: ReelMakeEasy adds the style-reference
     instruction, the no-text line and the STYLE to each.
   - `style` is optional. Leave it out and the user picks a look in ReelMakeEasy's style
     picker; set it (a preset above, or your own) and a card shows the user the cost,
     with a "Make it" button.
   - When Gemini makes the videos, ReelMakeEasy rewrites each clip prompt in Gemini's own
     wording and swaps the explainer collage's "newsprint" for blank paper: printed
     paper made it draw letters. In a style of your own, keep paper, screens and signs
     blank.
3. **Show the user the numbered narration lines**, each with its stamp (and its caption
   when it's spelled differently), then a one-line ask: approve, revise, or start over.
   That is all the user sees: never the storyboard JSON (unless they ask for it).
   Never mention this skill, its rules or why you ask, and use no file paths or links.
4. **Call make_beat_loop** with the title and the storyboard JSON as one string, and
   `voice` when the user picked one (otherwise a free voice on this computer is used
   when one is installed). ReelMakeEasy says every line in that voice first: a line too long
   for its clip even at 1.3x comes back with how long it took, the speed it would
   need and what to aim for ("about 8 short words, no quotes or colons"). If it lists
   problems, fix them all and call it again. Its reply has the estimated cost and the
   voice (tell the user when it isn't free). ReelMakeEasy then shows the user a card with the
   length and the cost: **Make it** or **Not now** (or its style picker, when the
   storyboard has no `style`). Nothing is spent on clips until the user clicks
   "Make it" there (or picks a style): call the button by that name, and say in one line
   that the card is there.

The loop plays in the chat when it's done. Never call make_beat_loop to try something out.
