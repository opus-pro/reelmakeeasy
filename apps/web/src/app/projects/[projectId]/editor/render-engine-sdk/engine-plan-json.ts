/**
 * The editor engine (AVEditorEngine.wasm) knows a caption preset only by its own built-in
 * scheme, `opus://preset/<name>`: given any other address it draws the words without the
 * preset, so the highlighted word and the Explainer look are lost in the preview. ReelMakeEasy names
 * caption presets `caption-preset://<name>` everywhere else (the FFmpeg render reads that), so
 * the plan and its diffs are turned back into the engine's scheme only as they are handed to it.
 */
const CAPTION_PRESET = '"caption-preset://'
const ENGINE_CAPTION_PRESET = '"opus://preset/'

/** A plan or plan diff as JSON for the engine, with caption presets in the engine's scheme. */
export function toEnginePlanJson(value: unknown): string {
  return JSON.stringify(value).replaceAll(CAPTION_PRESET, ENGINE_CAPTION_PRESET)
}
