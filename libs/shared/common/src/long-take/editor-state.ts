import type { LongTakeEditorState, LongTakeTransition } from '@shared/types/api/long-take'

import { asStoreUri } from '../storage/address'
import { storeUriToUrl } from '../storage/stored-files'

/**
 * A content hash of the editor state, computed on BOTH sides: the api hashes the
 * canonical state read from storage, the browser hashes the state it was served,
 * and `render` refuses the export when they disagree.
 *
 * That makes the normalization load-bearing, because the two sides see different
 * spellings of the same object. Storage holds `store://` URIs; the API read may
 * return file URLs. So this normalizes toward `store://` -- `asStoreUri` also
 * strips the query, so a per-read query string never reaches the hash.
 *
 * Normalizing the other way (`storeUriToUrl`) breaks export: it leaves an
 * https URL untouched, so the browser would hash the query while the api hashed
 * a bare URL. Whatever else changes here, the hash MUST NOT include a query.
 */
export function buildLongTakeEditorRevision(state: LongTakeEditorState): string {
  const serialized = JSON.stringify({
    keyframes: [...state.keyframes]
      .map((keyframe) => ({
        keyframeUrl: asStoreUri(keyframe.keyframeUrl),
        shotId: keyframe.shotId,
      }))
      .sort((left, right) => left.shotId.localeCompare(right.shotId)),
    transitions: [...state.transitions]
      .map((transition) => serializeTransition(transition))
      .sort((left, right) => left.transitionId.localeCompare(right.transitionId)),
  })

  return fnv1a32(serialized)
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return (hash >>> 0).toString(16).padStart(8, '0')
}

function serializeTransition(transition: LongTakeTransition) {
  return {
    endMs: transition.endMs,
    fromShotId: transition.fromShotId,
    prompt: transition.prompt,
    startMs: transition.startMs,
    toShotId: transition.toShotId,
    transitionId: transition.transitionId,
    videoUri: asStoreUri(transition.videoUri),
  }
}
