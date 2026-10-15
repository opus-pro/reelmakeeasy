import { Fetcher } from '@reelmakeeasy/common/utils/fetcher'
import { createWeakMapFn } from '@reelmakeeasy/common/utils/memo-fn'

import type { AudioMetadataResult } from '@/util/media'
import { getAudioMetadataFromUrl } from '@/util/media'

import type { PlannerState } from '../state/planner-state'

export class AudioMetadataCache {
  private readonly map = new Map<string, Fetcher<AudioMetadataResult>>()

  constructor(private readonly capacity = 10) {}

  fetch(audioUrl: string) {
    // Key on the object, not on the query string. Two URLs for the same object
    // can differ only in their query, so keying on the raw string would miss --
    // and a miss here downloads the audio file again just to read its duration.
    // Dropping the query is enough; the fetch still uses the URL it was given.
    const key = audioUrl.split('?')[0] ?? audioUrl
    const cached = this.map.get(key)
    if (cached) {
      if (cached.data.state !== 'rejected') {
        this.map.delete(key)
        this.map.set(key, cached)
        return cached
      }
      this.map.delete(key)
    }

    if (this.map.size >= this.capacity) {
      const lruKey = this.map.keys().next().value as string
      this.map.delete(lruKey)
    }

    const fetcher = new Fetcher(() => getAudioMetadataFromUrl(audioUrl))
    this.map.set(key, fetcher)
    return fetcher
  }
}

export const getAudioMetadataCacheByPlanner = createWeakMapFn(
  (_state: PlannerState) => new AudioMetadataCache(),
)
