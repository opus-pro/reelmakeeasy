/**
 * The 8-bit look's library: a pixel stage (a low-res three.js scene, dithered and scaled up with
 * hard edges), a pixel-font HUD and an x-ray lens. ReelMakeEasy owns it and refreshes it on every
 * setup: use it, never edit it; put your own episode in `src/scenes/`.
 *
 * - `PixelStage` (Stage.tsx): `<PixelStage build={build} />`; `build(E)` makes the scene once and
 *   returns `{ update(t) }`, which sets everything from t alone.
 * - px.ts: `THREE`, `clamp`, `lerp`, `smooth`, `ss`, `easeOut`, `back`, `pulse`, `rng`, `flat`,
 *   `glow`, `inside`, `flow`, `windowTexture`.
 * - hud.ts: the HUD (`E.hud`: text, panel, hook, caption, stamp, counter, bar, gauge, trace,
 *   legend, poly, tag, ring, scope) and `fmt`; font.ts: the 5×7 pixel font.
 */
export * from './hud'
export * from './narration'
export * from './px'
export * from './Stage'
