/**
 * A regenerated clip is written to a new file, never over the old one: a cancelled run leaves
 * an orphan, the editor's undo keeps the old clip, and its Download sees a changed URL.
 */
export function regenerateOutputName(transitionId: string, stamp: string): string {
  return `${transitionId}-r${stamp}`
}

/** Where a clip file lives in a project's storage. */
export function transitionVideoPath(name: string): string {
  return `long_take/transitions/${name}.mp4`
}
