'use client'

import { resolveTransitionRenderVideoUri } from '@reelmakeeasy/common/long-take/render-transition-video-uri'
import type { VideoScript } from '@reelmakeeasy/common/types/video-script'
import type { LongTakeStatus, LongTakeTransition } from '@shared/types/api/long-take'

import { useBgmBedPlayback } from './useBgmBedPlayback'
import { isStoreUri, storeKeyOf } from '@reelmakeeasy/common/storage/address'

/** What a loop short's live preview plays besides its voice-over, captions and stamps. */
export interface LoopPreviewMedia {
  /** The clip sound bed, played beside the engine. */
  bedUrl: string
  /** The bed's 0-100 volume beside the voice-over, as its render measured it. */
  bedVolume: number
  /** The joined clips, played muted by the engine. */
  clipsUrl: string
}

/**
 * A loop short's preview media, from its status: its clip sound bed and the joined clips the
 * bed was made from, each keyed to its own file's version. Null without both (any other video,
 * or a loop whose bed is missing or older than its clips), when the preview can't sound like
 * the delivered file.
 */
export function loopPreviewMedia(
  status:
    | null
    | Pick<LongTakeStatus, 'loopClipsUrl' | 'loopSfxBedUrl' | 'loopSfxBedVolume'>
    | undefined,
): LoopPreviewMedia | null {
  const bedUrl = status?.loopSfxBedUrl
  const bedVolume = status?.loopSfxBedVolume
  const clipsUrl = status?.loopClipsUrl
  if (!bedUrl || bedVolume == null || !clipsUrl) return null
  return { bedUrl, bedVolume, clipsUrl }
}

/**
 * Whether a loop's joined clips (and so its clip sound bed) are the clips in its state: the
 * clips its last render saved in the video script's media track, as it joined them. The status
 * says only that the bed is newer than the joined clips. A loop's state takes new clips only
 * when a render delivers them, but it can still differ: the editor's edits not rendered yet, or
 * a render that has joined new clips and not yet saved them as the state (another take is
 * another file). False without both to compare.
 */
export function loopClipsMatchState(
  transitions:
    | ReadonlyArray<
        Pick<
          LongTakeTransition,
          'baseVideoUri' | 'lipSyncEnabled' | 'lipSyncVideoUri' | 'startMs' | 'videoUri'
        >
      >
    | undefined,
  videoScript: Pick<VideoScript, 'tracks'> | undefined,
): boolean {
  const joined = videoScript?.tracks.find((track) => track.type === 'media')?.segments
  if (!transitions?.length || !joined || joined.length !== transitions.length) return false
  const inState = [...transitions].sort((a, b) => a.startMs - b.startMs)
  const inScript = [...joined].sort((a, b) => a.timeline.in - b.timeline.in)
  return inState.every((clip, k) =>
    sameStoredFile(resolveTransitionRenderVideoUri(clip), inScript[k].content.sourceUri),
  )
}

// Whether two URIs name the same stored file: the state serves it from the files route
// (`<files URL>/<key>`) and the video script saves it as `store://<key>`. Keys hold the
// project's folder, so one ending in the other is the same file.
function sameStoredFile(a: string, b: string): boolean {
  const [keyA, keyB] = [storedFileKey(a), storedFileKey(b)]
  return keyA === keyB || keyA.endsWith(`/${keyB}`) || keyB.endsWith(`/${keyA}`)
}

// A URI's key (from a `store://` address) or path, without a version query.
function storedFileKey(uri: string): string {
  const path = uri.split('?')[0] ?? uri
  if (isStoreUri(path)) return storeKeyOf(path) ?? path
  return decodeURI(path.replace(/^[a-z]+:\/\/[^/]*/i, ''))
}

/**
 * Plays a loop short's clip sound beside its engine (`useBgmBedPlayback`): the engine plays
 * the clips muted and does not audibly mix a second audio track. On a loop of the video's
 * length, at the bed's volume mapped linearly, as it was measured (not the music's curve).
 * Nothing for any other video.
 */
export function useLoopSfxBedPlayback({
  engineMs,
  loop,
  playing,
  totalMs,
}: {
  engineMs: number
  loop: LoopPreviewMedia | null | undefined
  playing: boolean
  totalMs: number
}): void {
  useBgmBedPlayback({
    bedGainDb: null,
    enabled: !!loop,
    engineMs,
    loopMs: totalMs || undefined,
    playing,
    url: loop?.bedUrl ?? null,
    volume: loop?.bedVolume ?? 0,
  })
}
