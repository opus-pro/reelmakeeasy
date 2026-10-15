import { Grid } from '../../types/refine-v2-definition'

import { LeftTopRectPx, MediaInstant } from './base'

export type CropKeyFrame = MediaInstant & {
  cameraPosDuration: number
  /**
   * for debug: which camera pos this frame belongs to\
   * will be -1 if there is none
   */
  cameraPosIndex: number
  /** deprecated: This field is currently not in use. */
  exitTransitionDuration?: number
  exitTransitionName?: 'linear' | 'linear_end' | 'none'
  fakeFaceIds?: number[]
  /** for debug: frame index */
  frameIndex: number
  grid?: Grid
  keyFrameRects: KeyFrameRect[]
  layoutType: CropLayoutType
  screenRect?: LeftTopRectPx
  useScreen?: boolean
}

/**
 * set layout type for rendering
 * - fit: show all contents by adding padding into the top and the bottom (as CSS's `contain`)
 *   - currently works for no face or more than 2 faces detected
 * - fill: show content at a max aspect-ratio (as CSS's `cover`)
 *   - currently works for 1 face detected
 * - split: show content in a top/bottom 50%:50% layout
 *   - currently works for 2 face detected
 *   - cropRects index 0 on the top, index 1 on the bottom
 */
export type CropLayoutType = 'deleted' | 'fill' | 'fit' | 'four' | 'screenshare' | 'split' | 'three'
export type KeyFrameRect = {
  activeSpeakerRankedFirst?: boolean
  /** based on original video, HTML DOM-like coordinate system */
  cropRect?: LeftTopRectPx
  /** based on original video, HTML DOM-like coordinate system. */
  fakeFaceRects?: LeftTopRectPx[]
  /**
   * based on original video, HTML DOM-like coordinate system.
   * If no headRects, its value is undefined
   */
  headRects?: LeftTopRectPx[]
  peopleRects?: LeftTopRectPx[]
}
export type ReLayoutPlan = {
  cropKeyFrames: CropKeyFrame[]
  /** CuratedScene.id */
  sceneId: string
}
