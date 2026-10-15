import { PUBLIC_CDN_BASE_URL } from '../storage/public-assets'
import { ItemOf } from '../types'
import {
  AssetType,
  KeyFrame,
  LottieSeg,
  SegBase,
  SegType,
  TrackType,
  VideoSeg,
} from '../types/render-plan-struct'
import { Area, BaseSegment, ImageContent, MediaTrack, VideoContent } from '../types/video-script'
import { isProd } from '../utils/env'

import { getAssetType, getBaseId, getMode, getStartAndEnd } from './utils'

const DEFAULT_CROP_AREA: Pick<VideoSeg, 'cropPosition' | 'cropSize'> = {
  cropPosition: [{ ft: 0, mode: 0, v: [0, 0] }],
  cropSize: [{ ft: 0, mode: 0, v: [1, 1] }],
}
export class VideoAdapter {
  static convertLottieSegToVideoSeg(lottieSeg: LottieSeg, videoUri: string): VideoSeg {
    const firstImage = lottieSeg.params?.images?.[0]

    return {
      id: lottieSeg.id,
      type: SegType.Video,
      assetType: videoUri.endsWith('.webp') ? AssetType.WebP : AssetType.Video,
      uri: videoUri,
      in: lottieSeg.in,
      out: lottieSeg.out,
      anchor: lottieSeg.anchor || [0, 0],
      position: lottieSeg.position || [{ ft: 0, mode: 0, v: [0, 0] }],
      scale: lottieSeg.scale || [1, 1],
      rotate: lottieSeg.rotate || 0,
      opacity: lottieSeg.opacity || 1,
      ...(firstImage?.cropAreas ? this.getVideoCropAreas(firstImage.cropAreas) : DEFAULT_CROP_AREA),
      cropRotate: 0,
      loop: 0,
      speed: 1,
      trimStart: 0,
      trimEnd: lottieSeg.out - lottieSeg.in,
      volume: 0,
    }
  }

  static genBasicVideoSeg(content: ImageContent | VideoContent): {
    anchor: SegBase['anchor']
    assetType: AssetType
    loop: number
    opacity: number
    rotate: number
    speed: number
    type: SegType
    volume: number
  } {
    return {
      anchor: [0, 0] as SegBase['anchor'],
      assetType: getAssetType(content),
      loop: 0,
      opacity: 1,
      rotate: 0,
      speed: 1,
      type: SegType.Video,
      volume: content.resourceType === 'video' ? (content.volume ?? 100) : 0,
    }
  }

  static async genMediaTrack({
    getFilePath,
    track,
    usePreview = false,
  }: {
    getFilePath: (url: string) => Promise<string>
    track: MediaTrack
    usePreview?: boolean
  }): Promise<
    | undefined
    | {
        id: string
        segs: VideoSeg[]
        type: TrackType
      }
  > {
    const mediaSegs = track.segments.map(async (seg) => {
      const renderUri = this.getUriBySource(
        seg.content.sourceUri,
        seg.content.previewSourceUri,
        usePreview,
      )
      const uri = (await getFilePath?.(renderUri)) ?? renderUri
      const basicVideoSeg = VideoAdapter.genBasicVideoSeg(seg.content)
      const drawData = VideoAdapter.getVideoDrawData(seg.content)
      const timestamp = VideoAdapter.getVideoTimestamp(seg)

      return {
        id: seg.id,
        uri,
        ...basicVideoSeg,
        ...drawData,
        ...timestamp,
        loop: seg.loop ?? basicVideoSeg.loop,
        opacity: seg.content.opacity ?? basicVideoSeg.opacity,
        effects: await Promise.all(
          (seg.effects ?? []).map(async (e) => {
            const uri = `${await getFilePath(
              `${PUBLIC_CDN_BASE_URL}/ae-template/effect/${e.name}.tar.gz`,
            )}/${e.name}`
            return {
              type: 'ae-ef',
              uri,
              in: e.in,
              out: e.out,
            }
          }),
        ),
      }
    })
    return {
      id: getBaseId('MediaTrack'),
      segs: await Promise.all(mediaSegs),
      type: TrackType.Video,
    }
  }

  static getMockVideoSeg({ id, sourceUri }: { id: `content-${string}`; sourceUri: string }) {
    const mockContent: ImageContent | VideoContent = {
      cropAreas: [
        {
          frameTime: 0,
          mode: 'linear',
          position: {
            hPct: 1,
            wPct: 1,
            xPct: 0,
            yPct: 0,
          },
        },
      ],
      id,
      resourceType:
        sourceUri.endsWith('.mp4') || sourceUri.endsWith('.video') || sourceUri.endsWith('.webm')
          ? 'video'
          : 'image',
      sourceUri,
      targetAreas: [
        {
          frameTime: 0,
          mode: 'linear',
          position: {
            hPct: 1,
            wPct: 1,
            xPct: 0,
            yPct: 0,
          },
        },
      ],
    }
    return mockContent
  }

  static getVideoCropAreas(cropAreas: Area[]): Pick<VideoSeg, 'cropPosition' | 'cropSize'> {
    return {
      cropPosition: cropAreas.map((c) => VideoAdapter.getVideoPosition(c)),
      cropSize: cropAreas.map((c) => VideoAdapter.getVideoCropSize(c)),
    }
  }

  static getVideoCropSize(area: Area): KeyFrame<[number, number]> {
    const size: ItemOf<VideoSeg['cropSize']> = {
      ft: area.frameTime,
      mode: getMode(area.mode),
      v: [area.position.wPct ?? 1, area.position.hPct ?? 1],
    }

    return size
  }

  static getVideoDrawData(
    content: ImageContent | VideoContent,
  ): Pick<VideoSeg, 'cropPosition' | 'cropSize' | 'position' | 'scale'> {
    const crops = this.getVideoCropAreas(content.cropAreas)
    const targets = this.getVideoTargetAreas(content.targetAreas)

    return {
      ...crops,
      ...targets,
    }
  }

  static getVideoPosition(area: Area): KeyFrame<[number, number]> {
    const position: ItemOf<VideoSeg['cropPosition']> = {
      ft: area.frameTime,
      mode: getMode(area.mode),
      v: [area.position.xPct, area.position.yPct],
    }

    return position
  }

  static getVideoTargetAreas(targetAreas: Area[]): {
    position: KeyFrame<[number, number]>[]
    scale: KeyFrame<[number, number]>[]
  } {
    return {
      position: targetAreas.map((area) => VideoAdapter.getVideoPosition(area)),
      scale: targetAreas.map((area) => VideoAdapter.getVideoTargetScale(area)),
    }
  }

  static getVideoTargetScale(area: Area): KeyFrame<[number, number]> {
    const v = Math.max(area.position.wPct ?? 1, area.position.hPct ?? 1)
    const scale: ItemOf<VideoSeg['scale']> = {
      ft: area.frameTime,
      mode: getMode(area.mode),
      v: [v, v],
    }

    return scale
  }

  static getVideoTimestamp(
    seg: BaseSegment<ImageContent | VideoContent>,
  ): Pick<VideoSeg, 'in' | 'out' | 'trimEnd' | 'trimStart'> {
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
