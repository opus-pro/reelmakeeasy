import { CanvasSize } from '../../types'

import { LayoutAspectRatioType } from './render'

export const DEFAULT_FONT_LINE_HEIGHT = 1.2

export const EMOJI_B_PCT = pixelToBottomPercent(86, 1280) // 6.72
export const EMOJI_B_PCT_FOR_LANDSCAPE = pixelToBottomPercent(186, 720) // 25.83

function pixelToBottomPercent(pxValue: number, baseHeight: number): number {
  return +((pxValue / baseHeight) * 100).toFixed(2)
}

/**
 * percent, based on bottom
 * like: position: absolute, bottom: 954px
 * 954px / 1280px = 74.53 %
 */
export const topPercentForCaption = pixelToBottomPercent(954, 1280) // 74.53
/**
 * percent, based on bottom:
 * like: position: absolute, bottom: 245px
 * 245px / 1280px = 19.14 %
 */
export const bottomPercentForCaption = pixelToBottomPercent(245, 1280) // 19.14
/**
 * this mainly for fontSize and Emoji size
 * front-end is based on the exact size with Design file
 * which is:
 * - portrait: w: 720, h: 1280
 * - square: w: 1280, h: 1280
 * - four_five: w: 1024, h: 1280
 */
export function getScaleRatioBasedOnSizeFromDesignFile(
  stageSize: CanvasSize,
  layoutAspectRatio?: LayoutAspectRatioType,
): number {
  if (layoutAspectRatio === 'landscape') {
    return stageSize.height / 720
  }
  return stageSize.height / 1280
}

/**
 * like: position: absolute, bottom: 86px
 * `container.bottom` 86px to canvas's bottom
 */
export const bottomPercentForCaptionInLandscape = pixelToBottomPercent(86, 720) // 11.94

export const isSilence = (content: string): boolean => content === '__silence'

export const isMissing = (content: string): boolean => content === '__missing'

/**
 * CenterBasedRatio is taken center-middle point of canvas as origin,\
 * down and left is negative. Height is 2.
 *
 * [-1, 1] [0, 1] [1, 1]
 * [     ] [    ] [    ]
 * [-1, 0] [0, 0] [1, 0]
 * [     ] [    ] [    ]
 * [-1,-1] [0,-1] [1,-1]
 */
export function BottomBasedPctYToCenterBasedRatioY(pct: number): number {
  const bRatioY = pct / 100
  const tRatioY = 1 - bRatioY

  const coordinateH = 2
  const tY = tRatioY * coordinateH
  // coordinate move down half its size
  const cBasedY = tY - coordinateH / 2
  return -cBasedY
}
