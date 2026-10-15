import { KeyFrameLayoutType } from '../enums/refine-v2.enum'
import { TextElement, Timeline } from '../types/refine-v2-definition'
import {
  AssetType,
  KeyFrameInterpolationMode,
  SegBase,
  VerticalAlign,
  XyPair,
} from '../types/render-plan-struct'
import {
  AnimationMode,
  Duration,
  ImageContent,
  Position,
  VideoContent,
} from '../types/video-script'

import {
  calculateFitPosition,
  calculateFourPosition,
  calculateSplitPosition,
  calculateThreePosition,
} from './caption/calculate-position'
import {
  BottomBasedPctYToCenterBasedRatioY,
  bottomPercentForCaption,
  bottomPercentForCaptionInLandscape,
  topPercentForCaption,
} from './caption/canvas-render-config'
import { OverlayFrameBase } from './caption/refine'
import { LayoutAspectRatioType, RenderPreference } from './caption/render'

const modeMap: Record<AnimationMode, KeyFrameInterpolationMode> = {
  bezier: KeyFrameInterpolationMode.Bezier,
  linear: KeyFrameInterpolationMode.Linear,
}

export function getMode(mode: AnimationMode) {
  return modeMap[mode]
}

const assetTypeMap: Record<ImageContent['resourceType'] | VideoContent['resourceType'], AssetType> =
  {
    image: AssetType.Image,
    video: AssetType.Video,
    gif: AssetType.Gif,
    webp: AssetType.WebP,
  }

export function breakText(text: string, maxLength: number) {
  const words = text.split(' ')
  const lines = []
  let currentLine = ''
  for (const word of words) {
    if (currentLine.length + word.length > maxLength) {
      lines.push(currentLine)
      currentLine = ''
    }
    currentLine += `${word} `
  }

  return lines.join('\r')
}
export function calculatePositionForEditorV2(
  layoutType: KeyFrameLayoutType,
  type: 'caption' | 'emoji' | 'vhook',
  layoutAspectRatio: LayoutAspectRatioType,
): NonNullable<OverlayFrameBase['position']> {
  switch (layoutType) {
    case 'Fit': {
      return calculateFitPosition(type, layoutAspectRatio)
    }
    case 'Four': {
      return calculateFourPosition(type, layoutAspectRatio)
    }
    case 'ScreenShare': {
      return calculateSplitPosition(type, layoutAspectRatio)
    }
    case 'Split': {
      return calculateSplitPosition(type, layoutAspectRatio)
    }
    case 'Three': {
      return calculateThreePosition(type, layoutAspectRatio)
    }
    default: {
      return calculateFitPosition(type, layoutAspectRatio)
    }
  }
}
export function getAssetType(content: ImageContent | VideoContent) {
  return assetTypeMap[content.resourceType]
}
export function getBaseId(id: string, idx?: number): string {
  if (idx === undefined) {
    return `#${id}`
  }
  return `#${id}-${idx}`
}
export function getStartAndEnd({
  eO: endOffsetMs,
  eOAdj: endOffsetAdjustmentMs,
  sO: startOffsetMs,
  sOAdj: startOffsetAdjustmentMs,
}: Duration = {}): number[] {
  return [startOffsetAdjustmentMs ?? startOffsetMs ?? 0, endOffsetAdjustmentMs ?? endOffsetMs ?? 0]
}
export function pctPositionToPositionAndScale(position?: Position): {
  position: SegBase['position']
  scale: SegBase['scale']
} {
  if (!position) {
    return { position: [0, 0] as [number, number], scale: [1, 1] }
  }

  const scale = Math.max(position.wPct ?? 1, position.hPct ?? 1)

  return { position: [position.xPct, position.yPct], scale: [scale, scale] }
}
/**
 * Workaround for calculate caption/emoji position with layout type logic V2
 */

/**
 * boolean function with type infer
 */
export function toBoolean<T>(v: T): v is Exclude<T, 0 | '' | false | null | undefined> {
  return Boolean(v)
}

export const getByPos = (
  linePos: 'bottom' | 'middle' | 'top',
  layoutAspectRatio: RenderPreference['layoutAspectRatio'],
): { position: XyPair; vAlign?: VerticalAlign } => {
  const pctY = ((): number => {
    if (linePos === 'top') {
      return topPercentForCaption
    }
    if (linePos === 'middle') {
      return 50
    } // 50%, the middle of 100
    if (layoutAspectRatio === 'landscape') {
      return bottomPercentForCaptionInLandscape
    } // bottom
    return bottomPercentForCaption // bottom
  })()
  const posY = BottomBasedPctYToCenterBasedRatioY(pctY)

  const vAlign = linePos === 'middle' ? VerticalAlign.middle : VerticalAlign.bottom
  return { vAlign, position: [0, posY] }
}

interface Section {
  in?: number
  out?: number
  sectionTimeline?: Timeline
  timeline?: Timeline
}

export function getWordText(word: TextElement): string {
  return word.textAdjustment ?? word.text
}

/**
 * @param obj the section
 * @param obj.originSections based sections that already exists
 * @param obj.comparedSections compared sections that goes to hit the base sections
 * @param obj.originTimeOffset the origin section time offset
 * @param obj.comparedTimeOffset the compared section time offset
 * @returns return overlapped result from hit test, content comes from comparedSections
 */
export const computeConflictSections = <T extends Section>({
  originSections,
  comparedSections,
  originTimeOffset = 0,
  comparedTimeOffset = 0,
}: {
  comparedSections: T[]
  comparedTimeOffset?: number
  originSections: Section[]
  originTimeOffset?: number
}): T[] => {
  const conflictSections: T[] = []
  originSections.forEach((oSection) => {
    const tl = oSection.sectionTimeline ??
      oSection.timeline ?? { in: oSection.in, out: oSection.out }
    if (tl.in === undefined || tl.out === undefined) {
      return
    }
    const originTimelineIn = tl.in + originTimeOffset
    const originTimelineOut = tl.out + originTimeOffset
    comparedSections.forEach((cSection) => {
      const tl = cSection.sectionTimeline ??
        cSection.timeline ?? { in: cSection.in, out: cSection.out }
      if (tl.in === undefined || tl.out === undefined) {
        return
      }
      const timelineIn = tl.in + comparedTimeOffset
      const timelineOut = tl.out + comparedTimeOffset
      if (
        (timelineIn >= originTimelineIn && timelineIn < originTimelineOut) ||
        (timelineOut > originTimelineIn && timelineOut <= originTimelineOut) ||
        (timelineIn <= originTimelineIn && timelineOut >= originTimelineOut)
      ) {
        if (conflictSections.includes(cSection)) {
          return
        }
        conflictSections.push(cSection)
      }
    })
  })
  conflictSections.sort((a, b) => (a.in ?? 0) - (b.in ?? 0))
  return conflictSections
}

export const trimConflictSections = <T extends Section>({
  originSections,
  comparedSections,
  originTimeOffset = 0,
  comparedTimeOffset = 0,
}: {
  comparedSections: T[]
  comparedTimeOffset?: number
  originSections: Section[]
  originTimeOffset?: number
}):
  | { comparedSections: T[]; position: 'end' | 'middle' | 'start' }
  | { comparedSections: T[]; position: 'initial' } => {
  const conflictedSegments = computeConflictSections({
    originSections,
    comparedSections,
    originTimeOffset,
    comparedTimeOffset,
  })
  if (conflictedSegments.length === 0) {
    return {
      comparedSections,
      position: 'initial' as const,
    }
  }
  const startTarget = conflictedSegments[0]
  const endTarget = conflictedSegments[conflictedSegments.length - 1]
  const startIndex = comparedSections.indexOf(startTarget)
  const endIndex = comparedSections.indexOf(endTarget)
  comparedSections.splice(startIndex, endIndex - startIndex + 1)
  return {
    comparedSections,
    position:
      startIndex === 0
        ? ('start' as const)
        : endIndex === conflictedSegments.length - 1
          ? ('end' as const)
          : ('middle' as const),
  }
}
