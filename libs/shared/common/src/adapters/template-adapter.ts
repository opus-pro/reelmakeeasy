import { pick } from 'lodash-es'

import { Images, RenderTemplate } from '../template/type'
import {
  AssetType,
  BackgroundMode,
  EffectSeg,
  LottieSeg,
  SegType,
  Track,
  TrackType,
  VideoSeg,
} from '../types/render-plan-struct'
import {
  BaseSegment,
  TemplateAssetContent,
  TemplateAssetTrack,
  Timeline,
} from '../types/video-script'

import { VideoAdapter } from './video-adapter'

export type GetTemplateAssetPath = (data: { layoutId: string }) => Promise<string>

const generateTemplateAssetTrack = (trackId: string, index?: number): Track<LottieSeg> => {
  const suffix = typeof index === 'number' ? `-${index}` : ''
  return {
    id: `${trackId}.template-asset${suffix}`,
    segs: [],
    type: TrackType.Video,
  }
}

export const getTemplateAssetSegId = (
  segmentId: string,
  layoutId: string,
  contentId: string,
): string => {
  return `${segmentId}.${layoutId}.${contentId}`
}

export class TemplateAssetAdapter {
  static async genAssetTrack({
    getFilePath,
    getFallbackFontPath,
    getTemplateAssetPath,
    getMediaMetadata,
    getAllTemplatesSpec,
    track,
    usePreview = false,
  }: {
    getAllTemplatesSpec: () => Promise<RenderTemplate[]>
    getFallbackFontPath: () => Promise<string>
    getFilePath: (url: string, subDir?: string) => Promise<string>
    getMediaMetadata: (
      image: Images<string>['images'][number],
    ) => Promise<{ height: number; width: number }>
    getTemplateAssetPath: GetTemplateAssetPath
    track: TemplateAssetTrack
    usePreview?: boolean
  }): Promise<{
    bgTrack: Track<VideoSeg>
    effectTrack: Track<EffectSeg>
    lastEffectTrack: Track<EffectSeg>
    templateAssetTracks: Track<LottieSeg>[]
  }> {
    const effectTrack: Track<EffectSeg> = {
      id: `${track.id}.effect`,
      segs: [],
      type: TrackType.Effect,
    }

    const templateAssetTrack: Track<LottieSeg> = generateTemplateAssetTrack(track.id)
    const templateAssetTracks: Track<LottieSeg>[] = []

    const bgTrack: Track<VideoSeg> = {
      id: `${track.id}.bg`,
      segs: [],
      type: TrackType.Video,
    }

    const lastEffectTrack: Track<EffectSeg> = {
      id: `${track.id}.last-effect`,
      segs: [],
      type: TrackType.Effect,
    }

    const overlappedSegmentSet: Set<string> = new Set()
    for (let i = 0; i < track.segments.length - 1; i++) {
      const segment = track.segments[i]
      const nextSegment = track.segments[i + 1]
      if (segment.timeline.out > nextSegment.timeline.in) {
        overlappedSegmentSet.add(segment.id)
        overlappedSegmentSet.add(nextSegment.id)
      }
    }
    const overlappedSegmentIds: string[] = Array.from(overlappedSegmentSet)

    for (const segment of track.segments) {
      const content = segment.content
      // Only process background for 'fullscreen' layoutId
      if (content.params?.background && content.layoutId === 'fullscreen') {
        const renderUri = this.getUriBySource(
          content.params.background.uri,
          content.params.background.previewSourceUri,
          usePreview,
        )
        const sourceUri = await getFilePath?.(renderUri, `bg/${content.id}`)
        const mockContent = VideoAdapter.getMockVideoSeg({
          id: `content-${content.id}`,
          sourceUri,
        })
        mockContent.cropAreas = content.params.background.cropAreas ?? mockContent.cropAreas
        const baseVideoSeg = VideoAdapter.genBasicVideoSeg(mockContent)
        const drawData = VideoAdapter.getVideoDrawData(mockContent)

        bgTrack.segs.push({
          id: `segment-${content.layoutId}.${content.id}`,
          uri: sourceUri,
          ...baseVideoSeg,
          ...drawData,
          ...segment.timeline,
          volume: 0,
          ...VideoAdapter.getVideoTargetAreas([
            {
              frameTime: 0,
              mode: 'linear',
              position: segment.position ?? {
                xPct: 0,
                yPct: 0,
                wPct: 1.01,
                hPct: 1.01,
              },
            },
          ]),
          bg: {
            mode: BackgroundMode.blur,
            value: 50,
          },
        })
      }

      if (
        content.layoutId === 'small_object_large_people_explain' ||
        content.layoutId === 'two_people_mention' ||
        content.layoutId === 'centred_two_sticker_popup_compare'
      ) {
        const [params1, params2] = await this.genContentParamsForSplitLottie(
          content,
          segment.timeline,
          getFilePath,
          getTemplateAssetPath,
          getFallbackFontPath,
          usePreview,
        )
        const imageLeftSeg = {
          ...(await this.genLottieBase({
            content,
            getFilePath,
            getTemplateAssetPath,
            getFallbackFontPath,
            getAllTemplatesSpec,
            segment,
            usePreview,
          })),
          ...segment.timeline,
          ...params1,
        }

        const imageRightSeg = {
          ...(await this.genLottieBase({
            content,
            getFilePath,
            getTemplateAssetPath,
            getFallbackFontPath,
            getAllTemplatesSpec,
            segment,
            usePreview,
          })),
          ...segment.timeline,
          ...params2,
        }

        templateAssetTrack.segs.push(imageLeftSeg, imageRightSeg)
      } else {
        const seg = await this.genLottieBase({
          content,
          rotation: segment.rotation,
          getFilePath,
          getTemplateAssetPath,
          getMediaMetadata,
          getFallbackFontPath,
          getAllTemplatesSpec,
          segment,
          usePreview,
        })
        const overlappedSegmentIndex = overlappedSegmentIds.indexOf(segment.id)
        if (overlappedSegmentIndex === -1) {
          templateAssetTrack.segs.push({ ...seg })
        } else {
          const newTemplateAssetTrack = generateTemplateAssetTrack(track.id, overlappedSegmentIndex)
          newTemplateAssetTrack.segs.push({ ...seg })
          templateAssetTracks.push(newTemplateAssetTrack)
        }
      }
    }

    templateAssetTrack.segs.length && templateAssetTracks.unshift(templateAssetTrack)

    return {
      bgTrack,
      effectTrack,
      lastEffectTrack,
      templateAssetTracks,
    }
  }

  static async genContentParamsForSplitLottie(
    content: TemplateAssetContent,
    timeline: Timeline,
    getFilePath: (url: string, subDir?: string) => Promise<string>,
    getTemplateAssetPath: GetTemplateAssetPath,
    getFallbackFontPath: () => Promise<string>,
    usePreview = false,
  ) {
    const commonImages =
      content.params.images?.filter((image) => image.id !== 'a_1' && image.id !== 'a_2') ?? []
    const image1 = content.params.images?.find((image) => image.id === 'a_1')
    const image2 = content.params.images?.find((image) => image.id === 'a_2')

    if (!image1 || !image2) {
      throw new Error('Image a_1 or a_2 not found')
    }

    const p1 = this.gentContentParams(
      {
        ...content,
        params: {
          ...content.params,
          images: [...commonImages, image1],
        },
      },
      getFilePath,
      getFallbackFontPath,
      usePreview,
    )

    const p2 = this.gentContentParams(
      {
        ...content,
        params: {
          ...content.params,
          images: [...commonImages, { ...image2, id: 'a_1' }],
        },
      },
      getFilePath,
      getFallbackFontPath,
      usePreview,
    )

    const [params1, params2] = await Promise.all([p1, p2])

    function calculateTimeline(baseTimeline: Timeline, timeline?: Timeline) {
      if (!timeline) {
        return baseTimeline
      }
      return {
        in: baseTimeline.in + timeline.in,
        out: baseTimeline.in + timeline.out,
      }
    }

    return [
      {
        params: params1,
        ...calculateTimeline(timeline, image1?.timeline),
        uri: await getTemplateAssetPath({
          layoutId: `${content.layoutId}_a1`,
        }),
      },
      {
        params: params2,
        ...calculateTimeline(timeline, image2?.timeline),
        uri: await getTemplateAssetPath({
          layoutId: `${content.layoutId}_a2`,
        }),
      },
    ]
  }

  static async genLottieBase({
    content,
    rotation,
    scale = [1, 1],
    segment,
    getFilePath,
    getAllTemplatesSpec,
    getMediaMetadata,
    getTemplateAssetPath,
    getFallbackFontPath,
    usePreview = false,
  }: {
    content: TemplateAssetContent
    getAllTemplatesSpec: () => Promise<RenderTemplate[]>
    getFallbackFontPath: () => Promise<string>
    getFilePath: (url: string, subDir?: string) => Promise<string>
    getMediaMetadata?: (
      image: Images<string>['images'][number],
    ) => Promise<{ height: number; width: number }>
    getTemplateAssetPath: GetTemplateAssetPath
    rotation?: number
    scale?: [number, number]
    segment: BaseSegment<TemplateAssetContent>
    usePreview?: boolean
  }): Promise<LottieSeg> {
    const { targetAreas } = content
    const { position = undefined } = targetAreas
      ? VideoAdapter.getVideoTargetAreas(targetAreas)
      : {}
    return {
      assetType: AssetType.Lottie,
      id: getTemplateAssetSegId(segment.id, content.layoutId, content.id),
      layoutId: content.layoutId,
      params: await this.gentContentParams(content, getFilePath, getFallbackFontPath, usePreview),
      type: SegType.Lottie,
      uri: await getTemplateAssetPath({
        layoutId: content.layoutId,
      }),
      rotate: rotation,
      // for sound effect
      volume: 70,
      ...VideoAdapter.getVideoTargetAreas([
        {
          frameTime: 0,
          mode: 'linear',
          position: segment.position ?? {
            xPct: 0,
            yPct: 0,
            wPct: 1,
            hPct: 1,
          },
        },
      ]),
      ...segment.timeline,
      scale,
      position,
    }
  }

  static async gentContentParams(
    content: TemplateAssetContent,
    getFilePath: (url: string, subDir?: string) => Promise<string>,
    getFallbackFontPath: () => Promise<string>,
    usePreview = false,
  ) {
    return {
      images:
        content.params && 'images' in content.params
          ? await Promise.all(
              (content.params.images ?? []).map(async (image) => {
                const renderUri = this.getUriBySource(image.uri, image.previewSourceUri, usePreview)
                return {
                  ...image,
                  id: image.id,
                  uri: await getFilePath(
                    renderUri,
                    `${content.id}-${(Math.random() * 100).toFixed(2)}`,
                  ),
                  ...(image.cropAreas
                    ? pick(VideoAdapter.getVideoCropAreas(image.cropAreas), [
                        'cropPosition',
                        'cropSize',
                      ])
                    : {}),
                }
              }),
            )
          : [],
      texts:
        content.params && 'texts' in content.params
          ? await Promise.all(
              (content.params.texts ?? []).map(async (text) => {
                const wPct = content.targetAreas?.[0]?.position.wPct ?? 1
                const hPct = content.targetAreas?.[0]?.position.hPct ?? 1
                return {
                  ...text,
                  content: `${text.content ?? ''}`.replace(/\n/g, '\r'),
                  font: text.font?.uri
                    ? {
                        ...text.font,
                        uri: await getFilePath(text.font?.uri, 'fonts'),
                        fallbackUri: await getFallbackFontPath(),
                      }
                    : undefined,
                  wId: `${text.id}-w`,
                  fontSizeRatio: text.lines ? hPct / text.lines : undefined,
                  boxWidthRatio: text.lines ? wPct : undefined,
                  lines: undefined,
                }
              }),
            )
          : [],
    }
  }

  private static getUriBySource(
    uri?: string,
    previewSourceUri?: string,
    usePreview = false,
  ): string {
    if (usePreview && previewSourceUri?.trim()) {
      return previewSourceUri
    }
    return uri?.trim() || previewSourceUri?.trim() || ''
  }
}
