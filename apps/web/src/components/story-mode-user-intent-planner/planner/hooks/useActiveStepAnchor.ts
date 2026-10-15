import { useState } from 'react'

/**
 * Millisecond timestamp of when `label` last changed. Adjusting state during render (the
 * React-documented pattern for deriving state from a changed prop) resets the anchor the moment
 * the label differs from the previous render, without an extra render cycle.
 */
export function useActiveStepAnchor(label: string): number {
  const [anchor, setAnchor] = useState(() => ({ atMs: Date.now(), label }))

  if (anchor.label !== label) {
    setAnchor({ atMs: Date.now(), label })
    return Date.now()
  }

  return anchor.atMs
}
