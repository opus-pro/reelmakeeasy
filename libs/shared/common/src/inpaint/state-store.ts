import { fileStore } from '../storage/file-store'

import { normalizeInpaintState } from './normalize-state'
import type { InpaintGlobalState, InpaintGlobalStateInput } from './state'

export async function readInpaintState(projectId: string): Promise<InpaintGlobalState | null> {
  const f = file(getInpaintStatePath(projectId))
  const exists = await f.exists()
  if (!exists) {
    return null
  }
  const content = await f.read()
  return normalizeInpaintState(JSON.parse(content.toString('utf8')) as InpaintGlobalStateInput)
}

export async function writeInpaintState(
  projectId: string,
  state: InpaintGlobalState,
): Promise<number> {
  const json = JSON.stringify(state)
  await file(getInpaintStatePath(projectId)).write(json, { contentType: 'application/json' })
  return Buffer.byteLength(json)
}

/**
 * Stores `state` unless a state is stored already, and returns the one that is stored
 * afterwards: `state` itself, or the state another writer stored first (read back and
 * normalized). Two racing starts so run with the same state.
 */
export async function writeInpaintStateIfAbsent(
  projectId: string,
  state: InpaintGlobalState,
): Promise<InpaintGlobalState> {
  const written = await file(getInpaintStatePath(projectId)).writeIfAbsent(JSON.stringify(state), {
    contentType: 'application/json',
  })
  if (written) return state
  const winner = await readInpaintState(projectId)
  if (!winner) throw new Error(`Inpaint state for ${projectId} vanished after a concurrent write`)
  return winner
}

function file(key: string) {
  return fileStore.file(key)
}

// Deliberately module-private: every read of this blob must go through
// readInpaintState, which normalizes it.
function getInpaintStatePath(projectId: string): string {
  return `editor/${projectId}/inpaint/workflow-state.json`
}
