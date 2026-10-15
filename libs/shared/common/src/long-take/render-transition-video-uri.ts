import { asStoreUri } from '../storage/address'

import type { RenderFinalTransitionVideo } from './render-final.types'

export function resolveTransitionRenderVideoUri(
  segment: Pick<
    RenderFinalTransitionVideo,
    'baseVideoUri' | 'lipSyncEnabled' | 'lipSyncVideoUri' | 'videoUri'
  >,
): string {
  if (!segment.baseVideoUri || !segment.lipSyncVideoUri) {
    return segment.videoUri
  }
  return segment.lipSyncEnabled === false ? segment.baseVideoUri : segment.lipSyncVideoUri
}

// Canonical form for a persisted transition uri is store://. Editor state is served
// CDN-form, and a render that carries pending edits can hand that form straight
// back to the manifest writer, so both ends of that round trip normalize here.
// Every render-uri field matters: resolveTransitionRenderVideoUri can return any
// of the three.
export function normalizeTransitionRenderUris<
  T extends Pick<RenderFinalTransitionVideo, 'baseVideoUri' | 'lipSyncVideoUri' | 'videoUri'>,
>(segment: T): T {
  const baseVideoUri = segment.baseVideoUri ? asStoreUri(segment.baseVideoUri) : undefined
  const lipSyncVideoUri = segment.lipSyncVideoUri ? asStoreUri(segment.lipSyncVideoUri) : undefined
  const videoUri = asStoreUri(segment.videoUri)
  if (
    videoUri === segment.videoUri &&
    baseVideoUri === segment.baseVideoUri &&
    lipSyncVideoUri === segment.lipSyncVideoUri
  ) {
    return segment
  }
  return {
    ...segment,
    ...(segment.baseVideoUri !== undefined && { baseVideoUri }),
    ...(segment.lipSyncVideoUri !== undefined && { lipSyncVideoUri }),
    videoUri,
  }
}
