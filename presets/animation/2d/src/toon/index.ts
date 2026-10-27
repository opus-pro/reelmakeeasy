/**
 * The 2D look's library: two cartoon characters talking, drawn as SVG. ReelMakeEasy owns it and
 * refreshes it on every setup: use it, never edit it; put your own scenes in `src/scenes/`.
 *
 * - `ToonStage` (Stage.tsx): draws line i's `scene(t, i)` (or `diagram(t, i)` for the 'diagram'
 *   shot), the speech bubble and the fun-fact card, every frame.
 * - lib.ts: timing (`L` lines, `S` shot cuts, `lineAt`, `word(i, 'prefix')`, `ss`, `back`, `lerp`,
 *   `clamp`, `makeRnd`, `blink`, `speaking`), lip sync (`mouthAt`, drawn with `mouth`), `eye`,
 *   `chip`, and `layer` (parallax through the camera).
 * - toon.ts: `arm`, `legs`, `glove`, `sparkle`, `INK`, and `camera(t, i, shot, FRAMES)`.
 */
export * from './lib'
export * from './Stage'
export * from './toon'
