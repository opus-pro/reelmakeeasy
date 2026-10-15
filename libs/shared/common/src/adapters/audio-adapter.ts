import { AssetType, AudioSeg, SegType, TrackType } from '../types/render-plan-struct'
import { AudioContent, AudioTrack, BaseSegment } from '../types/video-script'

import { getBaseId, getStartAndEnd } from './utils'

export class AudioAdapter {
  static async genAudioTrack({
    getFilePath,
    track,
    usePreview = false,
  }: {
    getFilePath: (url: string) => Promise<string>
    track: AudioTrack
    usePreview?: boolean
  }): Promise<
    | undefined
    | {
        id: string
        segs: AudioSeg[]
        type: TrackType
      }
  > {
    const audioSegs = track.segments.map(async (seg) => {
      const renderUri = this.getUriBySource(
        seg.content.sourceUri,
        seg.content.previewSourceUri,
        usePreview,
      )
      const uri = (await getFilePath?.(renderUri)) ?? renderUri
      const basicAudioSeg = AudioAdapter.genBasicAudioSeg()
      const timestamp = AudioAdapter.getAudioTimestamp(seg)

      return {
        id: seg.id,
        uri,
        ...basicAudioSeg,
        ...timestamp,
      }
    })
    return {
      id: getBaseId('AudioTrack'),
      segs: await Promise.all(audioSegs),
      type: TrackType.Audio,
    }
  }

  static genBasicAudioSeg(): {
    assetType: AssetType
    loop: number
    speed: number
    type: SegType
    volume: number
  } {
    return {
      assetType: AssetType.Audio,
      loop: 0,
      speed: 1,
      type: SegType.Audio,
      volume: 100,
    }
  }

  static getAudioTimestamp(
    seg: BaseSegment<AudioContent>,
  ): Pick<AudioSeg, 'in' | 'out' | 'trimEnd' | 'trimStart'> {
    const [trimStart, trimEnd] = getStartAndEnd(seg.duration)
    return {
      ...seg.timeline,
      trimEnd,
      trimStart,
    }
  }

  private static getUriBySource(
    sourceUri?: string,
    previewSourceUri?: string,
    usePreview = false,
  ): string {
    if (usePreview && previewSourceUri?.trim()) {
      return previewSourceUri
    }
    return sourceUri?.trim() || previewSourceUri?.trim() || ''
  }
}
