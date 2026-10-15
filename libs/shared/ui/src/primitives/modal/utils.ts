import type * as React from 'react'

/** True when a node would render something (not undefined, null, false or ''). */
export function hasContent(node: React.ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== ''
}
