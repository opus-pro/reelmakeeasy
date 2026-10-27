import type * as THREE from 'three'

import type { ArmPose, Gesture } from './pose'

/**
 * A jointed arm for a 3D avatar: shoulder, elbow, wrist, a palm and five fingers of two joints,
 * posed for each gesture. Put `root` on the torso at the shoulder; call `pose(a)` every frame.
 * Metres; the arm hangs down -y; `side` 1 is the screen's right (the avatar's own left).
 */
export type Arm3D = { pose: (a: ArmPose) => void; root: THREE.Group }

/** Joint angles (degrees) and finger curls (0 straight .. 1 curled: thumb, index, middle, ring,
 *  pinky) for a gesture: `abduct` raises the arm out to the side, `flex` forward, `twist` turns
 *  the upper arm so the elbow bends outward (+) or across the body (-), `elbow` bends the forearm,
 *  `roll` turns the forearm (palm), `wrist` bends the hand back (-) or forward (+). */
type Shape = {
  abduct: number
  curl: [number, number, number, number, number]
  elbow: number
  flex: number
  roll: number
  twist: number
  wrist: number
}

const SHAPES: Record<Gesture, (n: number, since: number) => Shape> = {
  count: (n) => ({
    abduct: 12,
    curl: [n >= 5 ? 0 : 0.9, n >= 1 ? 0 : 1, n >= 2 ? 0 : 1, n >= 3 ? 0 : 1, n >= 4 ? 0 : 1],
    elbow: 130,
    flex: 18,
    roll: 180,
    twist: 15,
    wrist: 0,
  }),
  open: () => ({
    abduct: 12,
    curl: [0, 0.05, 0.05, 0.1, 0.15],
    elbow: 80,
    flex: 14,
    roll: 0,
    twist: 12,
    wrist: -25,
  }),
  point: () => ({
    abduct: 55,
    curl: [0.8, 0, 1, 1, 1],
    elbow: 25,
    flex: 40,
    roll: 90,
    twist: 20,
    wrist: 0,
  }),
  rest: () => ({
    abduct: 6,
    curl: [0.3, 0.3, 0.35, 0.4, 0.45],
    elbow: 10,
    flex: 3,
    roll: 70,
    twist: 0,
    wrist: 0,
  }),
  shrug: () => ({
    abduct: 18,
    curl: [0.1, 0.1, 0.15, 0.2, 0.25],
    elbow: 85,
    flex: 10,
    roll: 0,
    twist: 30,
    wrist: -10,
  }),
  think: () => ({
    abduct: 4,
    curl: [0.6, 1, 1, 1, 1],
    elbow: 152,
    flex: 48,
    roll: 90,
    twist: -38,
    wrist: 20,
  }),
  thumb: () => ({
    abduct: 12,
    curl: [0, 1, 1, 1, 1],
    elbow: 95,
    flex: 25,
    roll: 90,
    twist: 20,
    wrist: 0,
  }),
  wave: (_n, since) => ({
    abduct: 32,
    curl: [0, 0, 0, 0.05, 0.1],
    elbow: 115 + 12 * Math.sin(since * 9),
    flex: 6,
    roll: 110,
    twist: 70,
    wrist: 0,
  }),
}

const D = Math.PI / 180

export function makeArm3D(
  three: typeof THREE,
  {
    scale = 1,
    side,
    skin,
    sleeve,
  }: { scale?: number; side: -1 | 1; skin: THREE.Material; sleeve: THREE.Material },
): Arm3D {
  const s = scale
  const root = new three.Group()
  root.rotation.order = 'ZXY'
  const capsule = (r: number, len: number, mat: THREE.Material) => {
    const m = new three.Mesh(new three.CapsuleGeometry(r, len, 6, 12), mat)
    m.position.y = -len / 2
    m.castShadow = true
    return m
  }
  root.add(capsule(0.055 * s, 0.25 * s, sleeve))
  const elbow = new three.Group()
  elbow.position.y = -0.28 * s
  root.add(elbow)
  elbow.add(capsule(0.047 * s, 0.22 * s, sleeve))
  const wrist = new three.Group()
  wrist.position.y = -0.255 * s
  wrist.rotation.order = 'YXZ'
  elbow.add(wrist)
  const palm = new three.Mesh(new three.BoxGeometry(0.085 * s, 0.09 * s, 0.032 * s), skin)
  palm.position.y = -0.05 * s
  palm.castShadow = true
  wrist.add(palm)
  // Fingers: index to pinky across the palm (the index on the thumb's side, toward the body).
  const fingers: { a: THREE.Group; b: THREE.Group }[] = []
  const xs = [-0.03, -0.01, 0.01, 0.03].map((x) => x * side * s)
  const lengths = [0.045, 0.05, 0.046, 0.038]
  xs.forEach((x, j) => {
    const a = new three.Group()
    a.position.set(x, -0.095 * s, 0)
    const len = (lengths[j] as number) * s
    a.add(capsule(0.011 * s, len * 0.5, skin))
    const b = new three.Group()
    b.position.y = -len * 0.62
    b.add(capsule(0.01 * s, len * 0.42, skin))
    a.add(b)
    wrist.add(a)
    fingers.push({ a, b })
  })
  const thumbA = new three.Group()
  thumbA.position.set(0.045 * -side * s, -0.04 * s, 0.01 * s)
  thumbA.rotation.z = side * 35 * D
  const thumbB = new three.Group()
  thumbB.position.y = -0.03 * s
  thumbA.add(capsule(0.013 * s, 0.025 * s, skin))
  thumbB.add(capsule(0.012 * s, 0.022 * s, skin))
  thumbA.add(thumbB)
  wrist.add(thumbA)

  const restShape = SHAPES.rest(0, 0)
  return {
    pose(a: ArmPose) {
      const to = SHAPES[a.gesture](a.n, a.since)
      const k = a.gesture === 'rest' ? 0 : a.k
      const mix = (x: number, y: number) => x + (y - x) * k
      root.rotation.z = side * mix(restShape.abduct, to.abduct) * D
      root.rotation.x = -mix(restShape.flex, to.flex) * D
      root.rotation.y = side * mix(restShape.twist, to.twist) * D
      elbow.rotation.x = -mix(restShape.elbow, to.elbow) * D
      wrist.rotation.y = -side * mix(restShape.roll, to.roll) * D
      wrist.rotation.x = -mix(restShape.wrist, to.wrist) * D
      const curl = restShape.curl.map((c, j) => mix(c, to.curl[j] as number))
      fingers.forEach((f, j) => {
        const c = curl[j + 1] as number
        f.a.rotation.x = -c * 1.3
        f.b.rotation.x = -c * 1.5
      })
      const t = curl[0] as number
      thumbA.rotation.x = -t * 0.9
      thumbB.rotation.x = -t * 1.1
    },
    root,
  }
}
