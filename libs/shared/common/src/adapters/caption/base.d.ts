/**
 *******************************************************************************
 * base.d.ts
 *******************************************************************************
 */

/**
 * area in a 2d plane, based on HTML DOM-like coordinate system
 * pixel based
 */
export type LeftTopRectPx = {
  /** height */
  h: number
  /** left */
  l: number
  /** top */
  t: number
  /** width */
  w: number
}
export type MediaInstant = {
  offsetBase?: OffsetBase
  offsetMs: number
}
export type MediaTimeRange = {
  offsetBase?: OffsetBase
  offsetEndMs: number
  offsetStartMs: number
}
export type OffsetBase = {
  id: string
  type: 'RAW' | 'ROUGH_CUT' | 'UNKNOWN'
}
