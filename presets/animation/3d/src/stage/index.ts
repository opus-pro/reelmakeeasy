/**
 * The 3D look's library: a full-resolution three.js stage under studio light, camera moves and
 * labels. ReelMakeEasy owns it and refreshes it on every setup: use it, never edit it; put your own
 * episode in `src/scenes/`.
 *
 * - `Stage3D` (Stage.tsx): `<Stage3D build={build} />`; `build(E, font)` makes the scene once and
 *   returns `{ update(t) }`, which sets everything from t alone.
 * - engine.ts: `THREE`, `E` (`scene`, `camera`, `renderer`, `labels`, `toScreen`, `sync`), `cam`
 *   (`orbit`, `move`), `label(g, text, [px, py], [ox, oy], { k, color, fontFamily })`, `mat`,
 *   `emissive`, `ss`, `back`, `lerp`, `clamp`, `rng`.
 */
export * from './engine'
export * from './Stage'
