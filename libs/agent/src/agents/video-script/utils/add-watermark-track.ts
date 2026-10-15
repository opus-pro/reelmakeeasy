import { MediaTrack, VideoScript } from '@reelmakeeasy/common/types/video-script'
import { getPublicStoreUri } from '@reelmakeeasy/common/storage/stored-files'
import { genNanoId } from '@reelmakeeasy/common/utils/gen-nano-id'
import { cloneDeep } from 'lodash-es'

const WATERMARK_DURATION = 4000

export async function addWatermarkTrack(videoScript: VideoScript): Promise<VideoScript> {
  videoScript = cloneDeep(videoScript)
  // Read storyboard
  const videoDuration =
    videoScript.tracks.find((track) => track.type === 'template-asset')?.segments.at(-1)?.timeline
      .out ?? 0

  const watermarkTrack: MediaTrack = {
    id: 'track-watermark',
    type: 'media',
    segments: generateWatermarkSegments(videoDuration),
  }
  videoScript.tracks.push(watermarkTrack)
  return videoScript
}

export function generateWatermarkSegments(videoDuration: number): MediaTrack['segments'] {
  const counts = Math.ceil(videoDuration / WATERMARK_DURATION)
  return Array.from({ length: counts }, (_, i) => {
    const position = (() => {
      switch (i % 3) {
        case 0: {
          return {
            xPct: -0.5,
            yPct: -0.8,
          }
        }
        case 1: {
          return {
            xPct: 0.5,
            yPct: 0,
          }
        }
        case 2: {
          return {
            xPct: -0.5,
            yPct: 0.8,
          }
        }
        default: {
          return {
            xPct: 0,
            yPct: 0,
          }
        }
      }
    })()
    return {
      id: `segment-${genNanoId()}`,
      loop: 0,
      content: {
        opacity: 0.5,
        resourceType: 'webp',
        sourceUri: getPublicStoreUri('agent/images/watermark/watermark.webp'),
        cropAreas: [
          { frameTime: 0, mode: 'linear', position: { xPct: 0, yPct: 0, wPct: 1, hPct: 1 } },
        ],
        targetAreas: [
          {
            frameTime: 0,
            mode: 'linear',
            position: {
              hPct: 0.4,
              wPct: 0.4,
              xPct: position.xPct,
              yPct: position.yPct,
            },
          },
        ],
        id: `content-${genNanoId()}`,
      },
      duration: {
        sO: 0,
        eO: WATERMARK_DURATION,
      },
      timeline: {
        in: i * WATERMARK_DURATION,
        out: i === counts - 1 ? videoDuration : (i + 1) * WATERMARK_DURATION,
      },
    }
  })
}
