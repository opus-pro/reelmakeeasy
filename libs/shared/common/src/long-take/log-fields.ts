import { ensureError } from '../utils/error-handler'

/**
 * Compact structured-log formatting helpers for the long-take render pipeline.
 * Extracted from render-final.ts (which sits at the max-lines ceiling);
 * bgm-bake.ts and caption-track.ts still carry local copies of
 * formatLogFields that can migrate here opportunistically.
 */
export function formatError(error: unknown): { message: string; name: string; stack?: string } {
  const err = ensureError(error)
  return { name: err.name, message: err.message, stack: err.stack }
}

export function formatLogFields(fields: Record<string, unknown>): string {
  try {
    return JSON.stringify(fields)
  } catch {
    return String(fields)
  }
}
