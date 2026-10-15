import type { Shot } from '../types'

import { auditNormalizeToken } from './long-take-beat-sheet-audit'

export function normalizeNarrationForCoverage(value: string): string {
  return value.trim().split(/\s+/).map(auditNormalizeToken).filter(Boolean).join(' ')
}

/**
 * Whether the shots' narration still spans the canonical script exactly.
 *
 * A synthesized 1:1 beat sheet inherits whatever coverage the existing shots
 * have, so reusing shots that stopped partway through the script pins every
 * later pass to that short segmentation.
 */
export function shotsCoverCanonicalScript(shots: Shot[], script: string): boolean {
  const canonical = normalizeNarrationForCoverage(script)
  if (!canonical) {
    return true
  }
  const covered = normalizeNarrationForCoverage(
    [...shots]
      .sort((a, b) => a.order - b.order)
      .map((shot) => shot.audio_vo)
      .join(' '),
  )
  return covered === canonical
}
