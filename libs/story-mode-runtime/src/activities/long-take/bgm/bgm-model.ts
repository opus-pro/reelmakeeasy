import { resolveRole } from '@reelmakeeasy/llm/registry'

/** A registry key for the `music` role (`lyria2` by default), or a legacy Lyria 3 id on older projects. */
export type BgmModel = string

/**
 * The music model for a BGM bed: the registry's `music` role. The duration no
 * longer picks a model; the bed is looped/trimmed to fit afterwards.
 */
export function selectBgmModel(_durationSec: number): BgmModel {
  const resolved = resolveRole('music')
  if (!resolved) {
    throw new Error('No music model is configured (roles.music is null)')
  }
  return resolved.key
}
