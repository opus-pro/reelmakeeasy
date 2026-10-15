---
name: reelmakeeasy-camera
description: Camera movement rules for ReelMakeEasy videos. Use when planning shots, storyboards, transitions or camera moves, or when the user asks for a more dynamic or calmer video.
---

# ReelMakeEasy camera rules

ReelMakeEasy videos are made of keyframes joined by short generated clips. Each clip goes from one keyframe to the next, and its prompt decides how the camera and everything in the frame move.

## The two camera styles

- **Calm**: Smooth, steady camera and longer shots. Shots are usually 5-8s. Suits reflective, explanatory or premium-feeling videos.
- **Dynamic**: Bold camera moves, quicker shots, something moving in every scene. Shots are usually 3-6s. Suits short social videos, news, facts and anything that must hold attention.

When the user asks for a livelier video, suggest Dynamic; when they find it too busy, suggest Calm.

## Dynamic: how each clip is written

- Each clip is two or three timed beats (`[m:ss.sss-m:ss.sss] text`), three when it is longer than 8 seconds.
- When the narration moves to its next idea inside a clip, that moment is a beat edge: the outgoing scene keeps its energy until then and the incoming subject lands after it.
- Each clip leads with one named camera move, and neighbouring clips never use the same one.

Camera moves to rotate through:
- a dolly in on a low arc
- a crane up
- an orbit around the subject
- a tracking shot alongside the action
- a fast low push-in
- a forward drive through the scene
- a hard bank and turn
- a rake across the frame
- a rack focus from foreground to subject
- a hard parallax move past foreground objects

=== PART 1 -- MOVEMENT. THIS IS WHAT DECIDES WHETHER THE CLIP WORKS ===

The most common failure is a prompt that is accurate and dead. Hailuo 3 renders the exact energy level you describe: describe a state and it holds a still image, then jumps. Every beat is full of action.

M1. THREE LAYERS, EVERY BEAT. A beat is not finished until all three are moving.
    - THE CAMERA -- one named move. For example: dollies in on a low arc, cranes up, orbits, tracks, pushes in fast and low, whips, banks hard, drives forward, rakes across, rack focus, hard parallax.
    - THE SUBJECTS -- at least two distinct changes to whatever the shot is actually about, caught mid-motion. Subjects are whatever this project has: people, animals, vehicles, objects, machines, drawn figures, diagrams, type, abstract shapes.
    - THE SURROUNDINGS -- at least one thing moving on its own that is neither the camera nor a main subject. For example, depending entirely on what this scene contains: light travelling across a wall, a figure crossing behind, fabric or hair, steam or dust, weather, water, traffic, foliage, a crowd, machinery, drawn marks in the margin of an illustrated frame.

M2. SPEED IS YOUR CHOICE. STILLNESS IS NOT. A slow push-in is a real and often beautiful shot; it fails only when nothing else in the frame is alive. Quiet camera, busy scene. Big camera move, simpler action underneath it. What never works is a beat where the camera is gentle AND the subjects are gentle AND the surroundings are gentle at the same time -- that is the beat that comes back as a held frame. Soften one layer and drive another harder. Words like slightly, gently and softly are fine on one layer at a time; they are a warning sign when they are on all three.

M3. A POSE IS NOT AN ACTION. Verbs that only state where a thing is or how it is arranged -- sits, stands, holds, rests, remains, waits, looks at, is positioned, is seen, appears -- can never be a subject's only verb. Whatever the subject is, it changes across the beat.
    Examples, one per kind of subject, to show the principle rather than to be copied:
    - a person who cannot leave their seat still laughs, throws their head back, snaps their gaze up, rocks forward, their shoulders shaking
    - an object still tips, rocks, spins, swings, topples, is struck or lifted
    - a drawn panel, diagram or interface still swings, tilts, is driven past by the camera, or is overtaken as the frame moves through it
    - an empty room or a landscape still changes through its light, its weather, and whatever crosses it
    If a subject cannot travel through space, everything else about it moves.

M4. START MID-ACTION. Something is already happening at 0.000. Never open by describing the first image -- it is already on screen.

M5. DO NOT WIND DOWN INTO THE ENDING. The final beat carries at least as much action as the first, and ideally more. Hailuo 3 reaches the last frame early and then holds on it; a prompt that calms toward the end makes that hold longer and more visible. Keep something moving all the way into the last frame.

M6. VERB DENSITY IS THE BUDGET. Spend characters on things happening, not on how things look. After every element is named once, every further sentence carries a verb of motion. If the prompt runs long, cut descriptions of appearance. Never cut actions.

=== PART 2 -- ONE UNBROKEN TAKE ===

T1. The beats are moments inside a single continuous shot, not separate shots. They exist to place action in time.

T2. Every beat after the first CONTINUES the movement of the one before it. For example: "the camera keeps driving forward", "still orbiting, it rises", "the push-in carries on past the near edge". A beat that opens by announcing a new framing or a new place is rendered as a cut and breaks the clip in half.

T3. Never describe how to get between the two images. No device for crossing -- no pan across, no whip to the next scene, no blur resolving into somewhere else. Describe both ends with full energy and let the model find its own way.

=== PART 3 -- ANYTHING READABLE ===

X1. NEVER instruct readable content to change, move or animate. For example: "ticks up", "slides upward", "pops into place", "scrolls", "counts up", "pulses", "flickers", "updates", "blurring with speed". Any such phrase makes the model invent states that exist in neither keyframe and letter them with gibberish. Protected: any screen or interface in the shot, and any lettering, numerals or symbols anywhere in frame on any surface -- for example a sign, a label, a headline, a wordmark, a caption baked into the image, handwriting. If a human could read it, it is protected.

X2. NAME every readable element and QUOTE every string verbatim in single quotes, exactly as it appears in the attached images, casing included. Vagueness is where invention enters.

X3. Say what a surface CARRIES or READS, never that it is unchanging, steady or held. The camera can move hard and the subjects can act hard while a surface still reads exactly the characters it reads in the keyframe. Still text does not require a still shot.

X4. Animate only what already exists in the two images. Never introduce a new object, figure, surface or word in order to create motion.

X5. Never put narration, captions or any words into the frame that are not already visible in the two images.

=== PART 4 -- WHAT NEVER APPEARS IN THE OUTPUT ===

N1. NO RULES. Never write "do not", "avoid", "must not", "ensure", "maintain", "keep". A prompt is a description of a shot, not a spec.

N2. NO STILLNESS VOCABULARY: holds steady, holds still, remains locked, perfectly still, settles into, static, stable, frozen, rests, sits centred, micro-movements, almost imperceptibly.

N3. NO ROUTE OR EDIT VOCABULARY: transition, bridge, wipes away, dissolves, sweeps across, seamlessly, graphic wipe, cuts to, previous shot, the view slides to, resolves into.

N4. NO ABSTRACT INTENT: establishing, highlighting, emphasizing, reinforcing, conveying, showcasing. Nothing to render, so the model invents something to satisfy it.

N5. Use "live-action" for filmed styles. Never "photorealistic" -- that word describes a still photograph and the model renders one.

=== PART 5 -- STYLE ===

S1. Preserve the style words from the vibe and the visual script: art style, palette, light, materials, era, linework, texture.
S2. Preserve nothing else of the visual script's phrasing. Style words are content; camera and transition directions are not.
S3. These rules hold for every style and every subject. All three layers of movement exist in live action, in 2D animation, in flat illustration, in 3D, in stop motion, and in a frame with no people in it at all -- only what fills each layer changes. Describe what this project's style actually contains, and never import an element from a style it does not use.
