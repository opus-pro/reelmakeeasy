import type * as THREE from 'three'

import type { Pose } from './pose'

/**
 * What an avatar is: `src/avatar/avatar.ts` exports `avatar`, one of these. The host kit poses it
 * on every frame; the avatar only draws the pose it is given.
 */

/**
 * A 2D avatar: `draw(p)` returns SVG markup in the avatar's own box, 1000 wide, origin at the
 * bottom centre (the waist, where the frame cuts it), y up is negative; the top of the hair near
 * y -1250, the face's centre near y -900, the shoulders near (±230, -600). The stage places,
 * scales, leans and breathes the whole box; the avatar moves its own head, face and arms.
 */
export type Avatar2D = {
  draw: (p: Pose) => string
  name: string
  /** `pixel`: a pixel-art avatar, drawn the same way and always shown cut to a pixel grid. */
  style: '2d' | 'pixel'
}

/**
 * A 3D avatar: `build(THREE)` makes it once (metres, origin at the waist, facing +z, the head's
 * centre about 0.72 m up, the shoulders about ±0.2 m) and returns its `root` and `pose(p)`, which
 * sets every part from the pose. The stage places the root and moves the camera.
 */
export type Avatar3D = {
  build: (three: typeof THREE) => { pose: (p: Pose) => void; root: THREE.Object3D }
  name: string
  style: '3d'
}

export type Avatar = Avatar2D | Avatar3D
