import { CaptionColorType } from '../enums/refine-v2.enum'
import { isMissing, isNotVerbal, isSilence } from '../helpers/special-semantic-helper'
import { PUBLIC_STORE_PREFIX } from '../storage/public-assets'
import {
  CaptionContent,
  CaptionSegment,
  CaptionTrack as RefineCaptionTrack,
  KeyFrameTrack,
  TextStyle,
  TimeStampDuration,
} from '../types/refine-v2-definition'
import {
  AssetType,
  CaptionSeg,
  SegType,
  Track,
  TrackType,
  VerticalAlign,
  XyPair,
} from '../types/render-plan-struct'
import {
  CaptionTrack,
  FactsTrack,
  MediaTrack,
  Timeline,
  Track as AllTrackType,
} from '../types/video-script'
import { genNanoId } from '../utils/gen-nano-id'

import { CAPTION_DEFAULT_FONT_FAMILY } from './caption/caption-fonts'
import type { CaptionFrameSize } from './caption/caption-layout'
import { captionStampColor } from './caption/caption-look'
import { CaptionRenderReference } from './caption/caption-render-preference.zod'
import type { CaptionRenderPref } from './caption/caption-style'
import { type FactStampSeg, factStampSeg } from './caption/fact-stamps'
import { OverlayFrameBase } from './caption/refine'
import {
  captionStripSeg,
  holdAccentForWholeCaption,
  shortCaptionSegments,
} from './caption/short-captions'
import { fontFamilyMap, fontSizeMap } from './caption/text-util'
import {
  calculatePositionForEditorV2,
  computeConflictSections,
  getBaseId,
  getByPos,
  getStartAndEnd,
  getWordText,
  toBoolean,
  trimConflictSections,
} from './utils'
import { VideoAdapter } from './video-adapter'

export class TextAdapter {
  /** find track that should not have caption */
  static findNonCaptionTextTracks(tracks: AllTrackType[]) {
    // ignore for headingHook
    // Note: V2 agent uses 'segment-hook', V1 uses 'segment--media-hook'
    const hookTrack = tracks.find(
      (t) =>
        t.type === 'media' &&
        t.segments.some((s) => s.id === 'segment-hook' || s.id === 'segment--media-hook'),
    )
    const hookTimeline = hookTrack
      ? ({
          type: 'hook',
          rawTrack: hookTrack,
          timeline: hookTrack.segments?.map((i) => i.timeline),
        } as const)
      : null

    const templateAssetTrack = tracks.filter((t) => t.type === 'template-asset')
    const templateTracksWithText = templateAssetTrack.map((t) => {
      const segmentsWithText =
        t.segments?.filter(
          (seg) =>
            seg?.content?.params &&
            seg.content.params.texts &&
            seg.content.params.texts?.length > 0,
        ) ?? []
      return {
        type: 'template',
        rawTrack: t,
        timeline: segmentsWithText.map((i) => i.timeline),
      } as const
    })

    // avatar track
    const avatarTrack = tracks.find((t) => t.type === 'media' && t.id === 'track-ai-avatar')
    const avatarTimeline = avatarTrack
      ? ({
          type: 'avatar',
          rawTrack: avatarTrack,
          timeline: avatarTrack.segments?.map((i) => i.timeline),
        } as const)
      : null

    const resultTracks = [hookTimeline, ...templateTracksWithText, avatarTimeline].filter(toBoolean)
    const timelines: Timeline[] = resultTracks
      .flatMap((i) => i.timeline)
      .map((i) => ({ in: Math.round(i.in), out: Math.round(i.out) }))

    const uniqueFactory = () => {
      const uniqueSet = new Set<string>()
      return (key: string) => {
        if (uniqueSet.has(key)) {
          return false
        }
        uniqueSet.add(key)
        return true
      }
    }
    const unique = uniqueFactory()
    const uniqueTimelines = timelines.filter((i) => unique(`${i.in}-${i.out}`))

    return {
      tracks: resultTracks,
      timelines: uniqueTimelines,
    }
  }

  static async genCaptionBgTrack(
    captionTrack: Track<CaptionSeg>,
    getFilePath: (url: string, subDir?: string) => Promise<string>,
  ) {
    const mockContent = VideoAdapter.getMockVideoSeg({
      id: 'content-captionBg',
      sourceUri: `${PUBLIC_STORE_PREFIX}/ae-template/lottie/paper/backgrounds/semi-transparent-caption-cover.png`,
    })

    const track: MediaTrack = {
      type: 'media',
      id: 'track-captionBg',
      segments:
        captionTrack?.segs.map((s) => {
          return {
            content: mockContent,
            id: `segment-caption-bg-${s.id}`,
            loop: 1,
            duration: {
              eO: 3000, // it's loop, so duration does not matter
              sO: 0,
            },
            timeline: {
              in: s.in,
              out: s.out,
            },
          }
        }) ?? [],
    }
    const captionBgTrack = await VideoAdapter.genMediaTrack({
      getFilePath,
      track,
    })
    // update id
    if (captionBgTrack) {
      captionBgTrack.id = getBaseId('CaptionBgTrack', 3)
    }
    return captionBgTrack
  }

  /**
   * Every caption layer the editor preview and the export draw for a stored caption track,
   * bottom first: Explainer's paper strip, then the caption (genTextTrackFromTranscriptTrack);
   * the caption alone for a style without a strip; none with the captions off. The strip is
   * built from that very caption track, so the two always share words, times, place, tilt and font.
   */
  static async genCaptionTextTracks(input: {
    /**
     * The editor preview's render font pack archive (renderFontsArchiveUrl), for a pref with a
     * font of its own (`fontFace`); the export passes none, as its painter reads the unpacked
     * pack. Nothing changes with the style's own font.
     */
    fontGzipPath?: string
    noCaptionTimeline?: Timeline[]
    renderPref: CaptionRenderPref
    track: CaptionTrack
  }): Promise<Track<CaptionSeg>[]> {
    const generated = await this.genTextTrackFromTranscriptTrack(input)
    if (!generated) {
      return []
    }
    const captionTrack = withPreviewFont(generated, input.renderPref, input.fontGzipPath)
    const stripTrack = this.genCaptionStripTrack(captionTrack, input.renderPref)
    return stripTrack ? [stripTrack, captionTrack] : [captionTrack]
  }

  /**
   * A loop's fact stamps as the editor preview and the export draw them (caption/fact-stamps.ts):
   * one segment per stored stamp, its strip in the video's highlight colour as `renderPref` shows
   * it (captionStampColor), tilting one way, then the other. Drawn whatever the caption switch
   * says, and whether or not the style shows captions: they are facts, not captions. `frame` is
   * the frame drawn on (a loop's 1080 x 1920 by default); `fontGzipPath` is where the editor
   * engine loads PT Serif Bold from (the render font pack), and the export reads none. The export
   * draws each segment's square strip itself; an editor plan adds the strips as image layers
   * under the labels (factStampStripSeg), or the engine draws its own rounded box.
   */
  static genFactStampTrack(input: {
    fontGzipPath?: string
    frame?: CaptionFrameSize
    renderPref: CaptionRenderReference
    track: FactsTrack
  }): Track<FactStampSeg> {
    const color = captionStampColor(input.renderPref)
    const frame = input.frame ?? LOOP_FRAME
    return {
      id: getBaseId('FactStampTrack'),
      type: TrackType.Text,
      segs: input.track.segments.map((segment, index) =>
        factStampSeg({
          color,
          fontGzipPath: input.fontGzipPath,
          frame,
          id: segment.id,
          index,
          text: segment.content.text,
          timeline: segment.timeline,
        }),
      ),
    }
  }

  // change to transform on textualTrack
  static async genTextTrackFromTextualTrack({
    textualTrack,
    kfTrack,
    renderPref,
    getAnimationCaptionFilePath,
    getFontPaths,
    getGZipFontPath,
    shouldSyncTimeline = true,
  }: {
    getAnimationCaptionFilePath: (animationName: string) => Promise<string>
    getFontPaths?: (font: { family: string; path?: string }) => Promise<string[] | undefined>
    getGZipFontPath?: (font: { family: string; path?: string }) => Promise<string | undefined>
    kfTrack?: KeyFrameTrack
    renderPref: CaptionRenderReference
    shouldSyncTimeline?: boolean
    textualTrack?: RefineCaptionTrack
  }): Promise<Track<CaptionSeg> | undefined> {
    if (!textualTrack || !renderPref.enableCaption) {
      return undefined
    }

    const {
      highlightColor,
      font,
      enableHighlight: _enableHighlight,
      enableSpeakerDetection,
      enableCaptionAnimation,
      captionAnimation,
      enableUppercase,
    } = renderPref
    const animationUri =
      enableCaptionAnimation && captionAnimation
        ? await getAnimationCaptionFilePath(captionAnimation.name)
        : undefined
    let segIn = 0

    const { position: fallbackPosition, vAlign } =
      TextAdapter.getTextBoxPositionAndAlign(renderPref)

    const fontPaths = await getFontPaths?.(font)
    let fontGzipPath: string | undefined
    if (font.type !== 'CustomizedFont') {
      fontGzipPath = await getGZipFontPath?.(font)
    }

    return {
      id: getBaseId('CaptionTrack'),
      type: TrackType.Text,
      segs: textualTrack.sections.flatMap((sec, i) => {
        const [segStart, segEnd] = getStartAndEnd(sec.sectionDuration)
        const data = sec.segments
          .map((_seg) => {
            const seg = _seg as CaptionSegment
            const [frameStart, frameEnd] = getStartAndEnd(seg.duration)
            const texts = (seg.content as CaptionContent).textElements
              .filter(
                (t) =>
                  getWordText(t) &&
                  !isSilence(t.text) &&
                  !isMissing(t.text) &&
                  !isNotVerbal(t.text),
              )
              .map((text) => {
                const t = getWordText(text)
                const dict = {
                  [CaptionColorType.Primary]: highlightColor.primary,
                  [CaptionColorType.Secondary]: highlightColor.secondary,
                  [CaptionColorType.Default]: undefined,
                }
                const enableHighlight = _enableHighlight && !enableSpeakerDetection
                const color = dict[enableHighlight ? text.color : CaptionColorType.Default]
                return {
                  t: enableUppercase ? t.toUpperCase() : t,
                  in: text.duration.sO - frameStart,
                  out: text.duration.eO - frameStart,
                  highlightColor: color,
                }
              })
            if (texts.length === 0) {
              return undefined
            }
            startWordsOneAfterAnother(texts)

            let position: typeof fallbackPosition = fallbackPosition
            if (renderPref.captionPosition === 'auto') {
              const curKeyFrameSegment = kfTrack?.sections
                .at(i)
                ?.segments.toReversed()
                .find((segment) => {
                  return segment.timeline.in <= seg.timeline.in
                })
              const ratio = renderPref?.layoutAspectRatio ?? 'portrait'

              if (curKeyFrameSegment) {
                const captionPosition = calculatePositionForEditorV2(
                  curKeyFrameSegment.content.layoutTypeAdjustment ??
                    curKeyFrameSegment.content.layoutType,
                  'caption',
                  ratio,
                )

                const newPosition = TextAdapter.getTextBoxPositionAndAlign(
                  renderPref,
                  captionPosition,
                )

                if (newPosition) {
                  position = [newPosition?.position[0], newPosition?.position[1]]
                }
              }
            }
            if (seg.positionAdjustment) {
              position = [seg.positionAdjustment.xPct, seg.positionAdjustment.yPct]
            } else if (
              renderPref.captionPosition === 'custom' &&
              !!renderPref.captionCustomStyle?.rect
            ) {
              position = [
                renderPref.captionCustomStyle.rect['xPct'],
                renderPref.captionCustomStyle.rect['yPct'],
              ]
            }

            let frameIn
            if (shouldSyncTimeline) {
              frameIn = frameStart - segStart + segIn
            } else {
              frameIn = seg.timeline.in
            }
            const frameDuration = frameEnd - frameStart

            return {
              id: seg.id || genNanoId(),
              position,
              scale: [seg.content.scale || 1, seg.content.scale || 1],
              uri: animationUri,
              vAlign,
              type: SegType.Text,
              assetType: AssetType.Text,
              autoScale: true,
              lineCount: renderPref.lineCount ?? 3,
              style: {
                ...TextAdapter.getFrameStyle(
                  renderPref,
                  'speakerId' in seg.content ? seg.content.speakerId : undefined,
                ),

                fontPaths,
                fontGzipPath,
              },
              in: frameIn,
              out: frameIn + frameDuration,
              texts,
            } as CaptionSeg
          })
          .filter((v) => v !== undefined)
        segIn += segEnd - segStart
        return data
      }),
    }
  }

  /**
   * The render plan caption track for a stored caption track. Short captions (Punch, Explainer:
   * `renderPref.chunking`) are split into 1-3 word chunks with the accent word lit for the whole
   * chunk, aligned on their middle wherever they sit, and Explainer's tilt alternates by chunk
   * (caption/short-captions.ts); the stored track is left as it is. This is the caption layer
   * only: genCaptionTextTracks also gives Explainer's strip under it.
   */
  static async genTextTrackFromTranscriptTrack({
    track,
    renderPref,
    noCaptionTimeline,
  }: {
    noCaptionTimeline?: Timeline[]
    renderPref: CaptionRenderPref
    track: CaptionTrack
  }): Promise<Track<CaptionSeg> | undefined> {
    const short = renderPref.chunking === 'short'
    const segments = short ? shortCaptionSegments(track.segments) : track.segments
    // sectionDuration.sO must stay 0; genTextTrackFromTextualTrack subtracts it
    // from each segment's start, so any non-zero value shifts captions earlier.
    const section: RefineCaptionTrack['sections'][number] = {
      segments: segments.map((seg) => {
        return {
          contentType: 'Caption',
          content: seg.content as unknown as CaptionContent,
          duration: seg.duration as unknown as TimeStampDuration,
          timeline: seg.timeline,
        }
      }),
      sectionDuration: {
        sO: 0,
        eO: track.segments[track.segments.length - 1].duration?.eO ?? 0,
      },
      sectionTimeline: {
        in: 0,
        out: track.segments[track.segments.length - 1].duration?.eO ?? 0,
      },
    }

    // caption with full-screen semi-transparent background
    const captionTrack = await this.genTextTrackFromTextualTrack({
      textualTrack: {
        sections: [section],
        trackType: 'CaptionTrack',
      },
      renderPref,
      getAnimationCaptionFilePath: async (name: string) => `caption-preset://${name}`,
    })
    if (!captionTrack) {
      return captionTrack
    }

    // filtered by track
    const shown = filterOutSegHasOverlapWithTimeline(captionTrack, noCaptionTimeline)
    if (!short) {
      return shown
    }
    const tilt = renderPref.strip?.tiltDeg
    return {
      ...shown,
      segs: shown.segs.map((seg, i) => {
        // One alignment at every height, so a slider tick and the slot it marks draw alike.
        const held = { ...holdAccentForWholeCaption(seg), vAlign: VerticalAlign.middle }
        // Clockwise, then anticlockwise: alternate captions lean the other way.
        return tilt ? { ...held, rotate: i % 2 === 0 ? tilt : -tilt } : held
      }),
    }
  }

  static getFrameStyle(
    renderPref: CaptionRenderReference,
    speakerId?: string,
  ): {
    animationBgColor?: string
    animationColor?: string
    fontColor?: string
    fontFamily: string
    fontId: string
    fontSize: number
    fontWeight: number
    italic: boolean
    shadowBlur?: number
    shadowColor?: string
    shadowOffsetX?: number
    shadowOffsetY?: number
    strokeColor?: string
    strokeWidth?: number
    underline: boolean
  } {
    const { font, captionAnimation, enableSpeakerDetection, speakersColor } = renderPref
    const speakerColor = speakersColor?.find((s) => s.id === speakerId)?.color

    return {
      fontId: '',
      fontWeight: Number(font.style.find((v) => v !== 'italic')),
      fontColor: enableSpeakerDetection ? speakerColor : font.color,
      fontFamily: fontFamilyMap[font.family] ?? font.family,
      strokeColor: font.stroke.enabled ? font.stroke.color : undefined,
      strokeWidth: font.stroke.enabled ? font.stroke.width : undefined,
      underline: font.textDecoration === 'underline',
      italic: Boolean(font.style.includes('italic')),
      fontSize: font.numericalSize ?? fontSizeMap[font.size ?? 'Large'],
      animationColor: enableSpeakerDetection ? speakerColor : captionAnimation?.highlightColor,
      animationBgColor: captionAnimation?.bgColor,
      ...(font.shadow.enabled
        ? {
            shadowColor: font.shadow.color,
            shadowOffsetX: font.shadow.x,
            shadowOffsetY: font.shadow.y,
            shadowBlur: font.shadow.blur,
          }
        : undefined),
    }
  }

  static getTextBoxPositionAndAlign(
    renderPref: CaptionRenderReference,
    position?: OverlayFrameBase['position'],
  ): {
    position: XyPair
    vAlign?: VerticalAlign
  } {
    const { captionPosition, layoutAspectRatio } = renderPref

    if (captionPosition && captionPosition !== 'auto' && captionPosition !== 'custom') {
      return getByPos(captionPosition, layoutAspectRatio)
    }

    if (position?.vAlign === 'center') {
      return getByPos('middle', layoutAspectRatio)
    }
    if (position?.bPct) {
      return getByPos('bottom', layoutAspectRatio)
    }
    if (position?.tPct) {
      return getByPos('top', layoutAspectRatio)
    }

    return getByPos('bottom', layoutAspectRatio)
  }

  static getTextOverlayStyle(textStyle: TextStyle): {
    animationBgColor?: string
    borderRadius?: number
    fontColor?: string
    fontFamily: string
    fontId: string
    fontSize?: number
    fontWeight: number
    italic: boolean
    underline: boolean
  } {
    return {
      fontId: '',
      fontFamily: fontFamilyMap[textStyle.fontFamily || ''] ?? textStyle.fontFamily,
      fontWeight: Number(textStyle.fontWeight),
      fontColor: textStyle.fontColor,
      underline: textStyle.textDecoration === 'underline',
      italic: !!textStyle.italic,
      fontSize: textStyle.fontSize,
      animationBgColor: textStyle.backgroundColor,
      borderRadius: textStyle.borderRadius,
    }
  }

  static replaceTextTrackByRenderPlanVoiceOverTrack =
    (voiceOverTrack: Track<CaptionSeg>) => (track: Track<CaptionSeg>) => {
      const continuousGroups: CaptionSeg[][] = voiceOverTrack.segs.reduce((result, seg) => {
        const lastGroup = result.at(-1)
        const lastSeg = lastGroup?.at(-1)
        if (lastSeg?.out === seg.in) {
          lastGroup?.push(seg)
        } else {
          const lastGroup: CaptionSeg[] = [seg]
          result.push(lastGroup)
        }
        return result
      }, [] as CaptionSeg[][])
      continuousGroups.forEach((segs) => {
        const conflictedSegments = computeConflictSections({
          originSections: segs,
          comparedSections: track.segs,
        })
        const startTarget = conflictedSegments[0]
        const endTarget = conflictedSegments[conflictedSegments.length - 1]
        conflictedSegments.forEach((conflictedSegment, index) => {
          if (index === 0 || index === conflictedSegments.length - 1) {
            return
          }
          const targetIndex = track.segs.indexOf(conflictedSegment)
          track.segs.splice(targetIndex, 1)
        })
        if (conflictedSegments.length > 0) {
          const pendingTargets: { target: typeof startTarget }[] = []
          pendingTargets.push({ target: startTarget })
          if (startTarget !== endTarget) {
            pendingTargets.push({ target: endTarget })
          }
          pendingTargets.forEach(({ target }) => {
            const { position } = trimConflictSections({
              originSections: segs,
              comparedSections: target.texts,
              comparedTimeOffset: target.in,
            })
            if (target.texts.length === 0) {
              const index = track.segs.indexOf(target)
              track.segs.splice(index, 1)
              return
            }
            if (position === 'initial') {
              return
            }
            if (position === 'end') {
              target.out = target.in + target.texts[target.texts.length - 1].out
            } else {
              const offset = target.texts[0].in
              target.in += offset
              target.texts.forEach((text) => {
                text.in -= offset
                text.out -= offset
              })
              if (position === 'middle') {
                target.out = target.in + target.texts[target.texts.length - 1].out
              }
            }
          })
        }
        const startIndex = track.segs.findLastIndex((segment) => {
          return segs[0].in >= segment.out
        })
        track.segs.splice(startIndex + 1, 0, ...segs)
      })
      return track
    }

  static runRenderPlanTrackPlugin<T extends Track<CaptionSeg>>(
    track: T,
    plugins: ((...args: [T]) => T)[],
  ): T {
    return plugins.reduce((track, pluginFunc) => {
      return pluginFunc(track)
    }, track)
  }

  /**
   * Explainer's paper strip under `captionTrack`: the same words, place and tilt. It is part of
   * the caption, not a cover, so it stays when the caption cover is hidden. None for a style
   * without a strip.
   */
  private static genCaptionStripTrack(
    captionTrack: Track<CaptionSeg>,
    renderPref: CaptionRenderPref,
  ): Track<CaptionSeg> | undefined {
    const { strip } = renderPref
    if (!strip) {
      return undefined
    }
    return {
      id: getBaseId('CaptionStripTrack'),
      type: TrackType.Text,
      segs: captionTrack.segs.map((seg) => captionStripSeg(seg, strip)),
    }
  }
}

/** A loop short's frame: every loop is delivered at 1080 x 1920. */
const LOOP_FRAME: CaptionFrameSize = { height: 1920, width: 1080 }

export function filterOutSegHasOverlapWithTimeline<T extends Track<CaptionSeg>>(
  track: T,
  noCaptionTimeline?: Timeline[],
): T {
  return {
    ...track,
    segs: track.segs.filter((seg) => {
      return !noCaptionTimeline?.some((timeline) => {
        return seg.in < timeline.out && seg.out > timeline.in
      })
    }),
  }
}

/**
 * A chosen font in the editor preview: every caption segment loads the render font pack archive
 * (the one URL the page's other pack faces use, so the engine fetches it once) and names
 * Montserrat after the family, as the engine's own fallback for a family it lacks is
 * unpredictable. The engine matches the face by its family and weight, which the pref already
 * snapped to one the pack has. Unchanged with the style's own font or without an archive.
 */
function withPreviewFont(
  track: Track<CaptionSeg>,
  renderPref: CaptionRenderPref,
  fontGzipPath: string | undefined,
): Track<CaptionSeg> {
  if (!renderPref.fontFace || !fontGzipPath) {
    return track
  }
  const fontFamily = `${renderPref.font.family}, ${CAPTION_DEFAULT_FONT_FAMILY}`
  return {
    ...track,
    segs: track.segs.map((seg) => ({ ...seg, style: { ...seg.style, fontFamily, fontGzipPath } })),
  }
}

/**
 * Moves each word's start to at least 1 ms after the previous word's. The editor engine ends a
 * word where the next one starts and drops a word left with no time, which the export would
 * still draw; strictly increasing starts keep every word in both.
 */
function startWordsOneAfterAnother(texts: Array<{ in: number; out: number }>): void {
  for (let i = 1; i < texts.length; i++) {
    if (texts[i].in > texts[i - 1].in) continue
    texts[i].in = texts[i - 1].in + 1
    texts[i].out = Math.max(texts[i].out, texts[i].in)
  }
}
