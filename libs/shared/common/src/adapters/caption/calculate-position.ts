import { autoPositions } from './auto-position'
import { EMOJI_B_PCT, EMOJI_B_PCT_FOR_LANDSCAPE } from './canvas-render-config'
import { CropKeyFrame, CropLayoutType } from './re-layout'
import { OverlayFrameBase } from './refine'
import { LayoutAspectRatioType } from './render'

export function calculateFillPosition(
  cropKeyFrame: CropKeyFrame,
  type: 'caption' | 'emoji' | 'vhook',
  layoutAspectRatio: LayoutAspectRatioType,
): NonNullable<OverlayFrameBase['position']> {
  const keyFrameRect = cropKeyFrame.keyFrameRects[0]
  const cropRect = keyFrameRect.cropRect

  if (!cropRect) {
    return {
      hAlign: 'center',
      ...autoPositions.vhook.top,
    }
  }
  const headRect = keyFrameRect.headRects?.find((h) => {
    const cropCenterL = cropRect.l + cropRect.w / 2
    // a head is in the crop when the center of the crop is in the head horizontally
    return cropCenterL > h.l && cropCenterL < h.l + h.w
  })
  if (!headRect) {
    if (type === 'caption') {
      return {
        hAlign: 'center',
        ...autoPositions.caption.bottom,
      }
    }
    if (type === 'emoji') {
      return getEmojiFramePosition(layoutAspectRatio)
    }
    return {
      hAlign: 'center',
      ...autoPositions.vhook.bottom,
    }
  }

  const headIsBig = headRect.h / cropRect.h >= 0.8
  const headIsAtTop = (headRect.t - cropRect.t) / cropRect.h <= 0.3
  if (headIsBig || headIsAtTop) {
    if (type === 'caption') {
      return {
        hAlign: 'center',
        ...autoPositions.caption.bottom,
      }
    }
    if (type === 'emoji') {
      return getEmojiFramePosition(layoutAspectRatio)
    }
    return {
      hAlign: 'center',
      ...autoPositions.vhook.bottom,
    }
  }
  if (type === 'caption') {
    return {
      hAlign: 'center',
      ...autoPositions.caption.top,
    }
  }
  if (type === 'emoji') {
    return getEmojiFramePosition(layoutAspectRatio)
  }
  return {
    hAlign: 'center',
    ...autoPositions.vhook.top,
  }
}
export function calculateFitPosition(
  type: 'caption' | 'emoji' | 'vhook',
  layoutAspectRatio: LayoutAspectRatioType,
): NonNullable<OverlayFrameBase['position']> {
  if (type === 'caption') {
    return {
      hAlign: 'center',
      ...autoPositions.caption.bottom,
    }
  }
  if (type === 'emoji') {
    return getEmojiFramePosition(layoutAspectRatio)
  }
  return {
    hAlign: 'center',
    ...autoPositions.vhook.top,
  }
}
export function calculateFourPosition(
  type: 'caption' | 'emoji' | 'vhook',
  layoutAspectRatio: LayoutAspectRatioType,
): NonNullable<OverlayFrameBase['position']> {
  if (type === 'emoji') {
    return getEmojiFramePosition(layoutAspectRatio)
  }
  return {
    hAlign: 'center',
    vAlign: 'center',
  }
}
export default function calculatePosition(
  cropKeyFrame: CropKeyFrame,
  layoutType: CropLayoutType,
  type: 'caption' | 'emoji' | 'vhook',
  layoutAspectRatio: LayoutAspectRatioType,
): NonNullable<OverlayFrameBase['position']> {
  switch (layoutType) {
    case 'fill': {
      return calculateFillPosition(cropKeyFrame, type, layoutAspectRatio)
    }
    case 'fit': {
      return calculateFitPosition(type, layoutAspectRatio)
    }
    case 'four': {
      return calculateFourPosition(type, layoutAspectRatio)
    }
    case 'screenshare': {
      return calculateSplitPosition(type, layoutAspectRatio)
    }
    case 'split': {
      return calculateSplitPosition(type, layoutAspectRatio)
    }
    case 'three': {
      return calculateThreePosition(type, layoutAspectRatio)
    }
    default: {
      return calculateFitPosition(type, layoutAspectRatio)
    }
  }
}
export function calculateSplitPosition(
  type: 'caption' | 'emoji' | 'vhook',
  layoutAspectRatio: LayoutAspectRatioType,
): NonNullable<OverlayFrameBase['position']> {
  return calculateFourPosition(type, layoutAspectRatio)
}
export function calculateThreePosition(
  type: 'caption' | 'emoji' | 'vhook',
  layoutAspectRatio: LayoutAspectRatioType,
): NonNullable<OverlayFrameBase['position']> {
  return calculateFourPosition(type, layoutAspectRatio)
}
export function getEmojiFramePosition(layoutAspectRatio?: LayoutAspectRatioType): {
  readonly bPct: number
  readonly hAlign: 'center'
} {
  return {
    bPct: layoutAspectRatio === 'landscape' ? EMOJI_B_PCT_FOR_LANDSCAPE : EMOJI_B_PCT,
    hAlign: 'center',
  } as const
}
