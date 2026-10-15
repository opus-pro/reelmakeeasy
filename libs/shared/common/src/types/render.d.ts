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

/**
 * based on the center of canvas
 * area in a 2d plane, based on Cartesian coordinate system
 * percentage based, relative to the short side of the canvas
 * ```
 * (-1,  1) | ( 1,  1)
 * --------------------
 * (-1, -1) | ( 1, -1)
 * ```
 */
export type RectPct = {
  /**
   * vertical dimension of the bounding box, divided by
   * the shorter of height and width of the canvas
   */
  hPct: number
  /**
   * horizontal dimension of the bounding box, divided by
   * the shorter of height and width of the canvas
   */
  wPct: number
  /**
   * horizontal distance between the center of the
   * bounding box and center of the canvas, divided by
   * the shorter of height and width of the canvas
   */
  xPct: number
  /**
   * vertical distance between the center of the
   * bounding box and center of the canvas, divided by
   * the shorter of height and width of the canvas
   */
  yPct: number
}

/**
 * area in a 2d plane, based on Cartesian coordinate system
 * pixel-based
 * use (0,0) as the center of coordinate
 */
export type RectPx = {
  /** height */
  h: number
  /** width */
  w: number
  /** horizontal displacement from the center */
  x: number
  /** vertical displacement from the center */
  y: number
}
