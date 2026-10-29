/**
 * The Avatar video look's library: a host (your avatar) talking to the camera. ReelMakeEasy owns
 * it and refreshes it on every setup: use it, never edit it. The avatar is `src/avatar/avatar.ts`;
 * your scenes go in `src/scenes/`.
 *
 * - `TalkingHead2D` / `TalkingHead3D`: the set, the avatar posed from the voice and your cues, a
 *   shot per line (`medium`, `close`, `corner`, `left`, `right`, `wide`) and the board (pictures in
 *   the free area of each shot).
 * - blocking.ts (2D): the host walks between spots, `transitions` per line (`move`, `cut`,
 *   `slide`, `whip`, `zoom`, `iris`), and `pointedAt(cues, t, spot)` for the thing pointed at.
 * - pose.ts: `hostPose(t, cues)` (what the stages do every frame), `Cue`, `Pose`, `Gesture`,
 *   `mouthShape(vowel)`, `stillPose(over)`.
 * - hands2d.ts: `drawArm(side, armPose, shoulder, { skin, sleeve, cuff })`, `armFor`, `hand`.
 * - arms3d.ts: `makeArm3D(THREE, { side, skin, sleeve })` → `{ root, pose(armPose) }`.
 * - framing.ts: `Shot`, `BOARD` (each shot's free area), `shotIndex(t)`.
 * - sounds.tsx: the gestures' sounds (`DEFAULT_GESTURE_SOUNDS`, the stages' `sounds` prop).
 */
export * from './arms3d'
export * from './avatar-types'
export * from './blocking'
export * from './framing'
export * from './hands2d'
export * from './Host2D'
export * from './Host3D'
export * from './pose'
export * from './sounds'
