import { MediaTimeRange } from './base'

export type AreaPositionBase = {
  type: PositionType
}
export type CenterPercentageAreaPosition = AreaPositionBase & {
  defaultRatioType?: DefaultRatioType
  /**
   * vertical dimension of the bounding box, divided by
   * the height of the canvas, ranged within [0, 1]
   */
  hPct: number
  /**
   * horizontal dimension of the bounding box, divided by
   * the width of the canvas, ranged within [0, 1]
   */
  wPct: number
  /**
   * horizontal distance between the center of the
   * bounding box and center of the canvas,
   * range within [-1, 1]
   */
  xPct: number
  /**
   * vertical distance between the center of the
   * bounding box and center of the canvas,
   * range within [-1, 1]
   */
  yPct: number
}
export type CoveredLayer = 'VHOOK'
export type CoveredLayers = {
  coveredLayerSource: MediaTimeRange
  name: CoveredLayer
}

/**
 * Area's default ratio type
 * Custom: Any ratios, not fixed
 * Others: fixed ratio
 */
export type DefaultRatioType =
  | '1:1'
  | '4:3'
  | '4:5'
  | '9:8'
  | '9:16'
  | '16:9'
  | 'Custom'
  | 'Original'
export type OverlayFrameBase = {
  /**
   * priority: assume that 3 of these will only has one
   * 1. vAlign
   * 2. bPct
   * 3. tPct
   */
  position?: {
    /**
     * bottom percentage, if undefined, calculate from top\
     * like the `n` in css definition `bottom: n%`;
     */
    bPct?: number
    /** when overlapped with other layers, don't render it  */
    coveredLayers?: CoveredLayers[]
    /** horizontal alignment */
    hAlign?: 'center'
    lPct?: number
    rPct?: number
    /**
     * top percentage, if undefined, calculate from bottom\
     * like the `n` in css definition `top: n%`;
     */
    tPct?: number
    /** vertical alignment */
    vAlign?: 'center'
  }
  /** timeRange to align with the original video */
  source: MediaTimeRange
  /** like the `transform` in css */
  style?: {
    scaleX?: number
    scaleY?: number
  }
}

/**
 * Position
 */
export type PositionType =
  | 'CPct' // CenterPercentage
  | 'CPx' // CenterPixel
  | 'LTPct' // LeftTopPercentage
  | 'LTPx' // LeftTopPixel
