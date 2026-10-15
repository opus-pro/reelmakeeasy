/**
 * The ElevenLabs key, read on every call (never cached) so a restarted API and
 * tests see the current environment. A blank value counts as unset.
 */
export function elevenLabsApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env['ELEVENLABS_API_KEY']?.trim() || undefined
}

export function hasElevenLabsKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return elevenLabsApiKey(env) !== undefined
}

/** Shown when something needs the user's own ElevenLabs account (cloning, their cloned voices). */
export const NEEDS_ELEVENLABS_KEY =
  'Needs an ElevenLabs key: add ELEVENLABS_API_KEY to .env, then restart ReelMakeEasy'
