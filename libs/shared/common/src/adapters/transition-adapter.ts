import { EffectSeg, SegType, Track, TrackType } from '../types/render-plan-struct'
import { TransitionTrack } from '../types/video-script'
import { PUBLIC_CDN_BASE_URL } from '../storage/public-assets'
import { isProd } from '../utils/env'

import { getBaseId } from './utils'

export class TransitionAdapter {
  static async genTransitionTrack({
    getFilePath,
    track,
  }: {
    getFilePath: (url: string, subDir?: string) => Promise<string>
    track: TransitionTrack
  }): Promise<Track<EffectSeg> | undefined> {
    if (!track.segments || track.segments.length === 0) {
      return undefined
    }

    const segs = await Promise.all(
      track.segments.map(async (segment) => {
        const transitionName = segment.content.name

        // Download the transition file
        await getFilePath(
          `${PUBLIC_CDN_BASE_URL}/ae-template/effect/${transitionName}.tar.gz`,
        )

        return {
          id: segment.id,
          in: segment.timeline.in,
          out: segment.timeline.out,
          type: SegType.AeEffect,
          uri: transitionName,
        }
      }),
    )

    return {
      id: getBaseId('TransitionTrack'),
      segs,
      type: TrackType.Effect,
    }
  }
}
