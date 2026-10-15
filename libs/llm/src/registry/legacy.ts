/**
 * Maps model ids from before the registry (hard-coded in pipeline code, stored
 * on old projects) onto roles, so they keep resolving. Browser-safe.
 */
import type { ModelKind, Role } from './schema'

export type LegacyTarget =
  /** Resolve to this registry key when it exists, otherwise by frames. */
  | { key: string; videoByFrames: true }
  /** Resolve through this role's model. */
  | { role: Role }
  /** Resolve through the `video.*` role that matches the frames supplied. */
  | { videoByFrames: true }

const IMAGE_PATTERNS = [/^dola-seedream-/, /^seedream-/, /^gemini-.*image/, /^gpt-image-/]

const VIDEO_PATTERNS = [
  /^veo-/,
  /^seedance/,
  /^dreamina-seedance/,
  /^pixverse/,
  /^grok-imagine-video/,
  /^vidu/,
  /^minimax/,
  /^hailuo/,
  /^happyhorse/,
  /^gemini-omni/,
  /^kling-o3-/,
]

const KLING_KEYS = new Set(['kling-3.0', 'kling-3.0-pro'])

export function legacyTarget(kind: ModelKind, id: string): LegacyTarget | null {
  const m = id.toLowerCase()
  if (kind === 'image' && IMAGE_PATTERNS.some((p) => p.test(m))) return { role: 'image.generate' }
  if (kind === 'music' && m.startsWith('lyria-')) return { role: 'music' }
  if (kind === 'video') {
    if (KLING_KEYS.has(m)) return { key: m, videoByFrames: true }
    if (VIDEO_PATTERNS.some((p) => p.test(m))) return { videoByFrames: true }
  }
  return null
}
