import type * as THREE from 'three'

import { type Avatar3D, makeArm3D, mouthShape, type Pose } from '../host'

/**
 * The avatar: a 3D starter to make your own. Change the colours, the hair, the head's shape, the
 * glasses or beard and the clothes until it looks like the person in the photo; keep the rig (the
 * pose drives the head, the eyes, the lids, the brows, the mouth and the arms). Metres, origin at
 * the waist, facing +z (the camera); the head's centre about 0.72 m up.
 */

const SKIN = '#F2C7A5'
const CHEEK = '#F0A090'
const HAIR = '#4A3426'
const IRIS = '#5B3A29'
const LIP = '#B5544F'
const SHIRT = '#3E6FB0'

const D = Math.PI / 180

export const avatar: Avatar3D = {
  build(three: typeof THREE) {
    const mat = (color: string, roughness = 0.6) =>
      new three.MeshStandardMaterial({ color, roughness })
    const skin = mat(SKIN, 0.55)
    const shirt = mat(SHIRT, 0.8)
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, [x, y, z]: number[] = [0, 0, 0]) => {
      const o = new three.Mesh(g, m)
      o.position.set(x ?? 0, y ?? 0, z ?? 0)
      o.castShadow = true
      return o
    }
    const root = new three.Group()

    // Torso, waist to shoulders (rounded at the shoulders), and the neck.
    const torso = new three.Group()
    root.add(torso)
    const chest = mesh(new three.CylinderGeometry(0.2, 0.17, 0.7, 32), shirt, [0, 0.05, 0])
    chest.scale.z = 0.62
    torso.add(chest)
    const shoulders = mesh(new three.CapsuleGeometry(0.075, 0.27, 8, 24), shirt, [0, 0.4, 0])
    shoulders.rotation.z = Math.PI / 2
    shoulders.scale.set(1, 1, 0.85)
    torso.add(shoulders)
    const collar = mesh(
      new three.TorusGeometry(0.058, 0.015, 10, 24),
      mat('#F4F1EA'),
      [0, 0.47, 0.005],
    )
    collar.rotation.x = Math.PI / 2
    torso.add(collar)
    torso.add(mesh(new three.CylinderGeometry(0.046, 0.05, 0.12, 16), skin, [0, 0.5, 0]))

    // Arms on the shoulders.
    const left = makeArm3D(three, { side: -1, skin, sleeve: shirt })
    const right = makeArm3D(three, { side: 1, skin, sleeve: shirt })
    left.root.position.set(-0.215, 0.42, 0)
    right.root.position.set(0.215, 0.42, 0)
    torso.add(left.root, right.root)

    // The head turns, nods and tilts about the top of the neck.
    const head = new three.Group()
    head.position.y = 0.5
    head.rotation.order = 'YXZ'
    torso.add(head)
    const skull = mesh(new three.SphereGeometry(0.125, 32, 24), skin, [0, 0.15, 0])
    skull.scale.set(1, 1.13, 1.02)
    head.add(skull)
    for (const s of [-1, 1]) {
      head.add(mesh(new three.SphereGeometry(0.026, 12, 10), skin, [s * 0.125, 0.15, 0]))
      const cheek = mesh(
        new three.CircleGeometry(0.022, 16),
        new three.MeshStandardMaterial({
          color: CHEEK,
          opacity: 0.45,
          roughness: 1,
          transparent: true,
        }),
        [s * 0.068, 0.115, 0.118],
      )
      cheek.rotation.y = s * 28 * D
      head.add(cheek)
    }
    head.add(mesh(new three.SphereGeometry(0.017, 12, 10), skin, [0, 0.14, 0.13]))
    // Hair: a cap over the top and back, and a fringe.
    const hairMat = mat(HAIR, 0.85)
    const cap = mesh(
      new three.SphereGeometry(0.135, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.52),
      hairMat,
      [0, 0.17, -0.008],
    )
    cap.scale.set(1.04, 1.18, 1.06)
    cap.rotation.x = -14 * D
    head.add(cap)
    const fringe = mesh(
      new three.CapsuleGeometry(0.03, 0.13, 6, 12),
      hairMat,
      [-0.02, 0.255, 0.098],
    )
    fringe.rotation.set(-35 * D, 0, 72 * D)
    head.add(fringe)

    // Eyes: a white ball with the iris and pupil on its front; a lid of skin rolls down to blink.
    const eyes: { ball: THREE.Group; lid: THREE.Mesh }[] = []
    const brows: THREE.Mesh[] = []
    for (const s of [-1, 1]) {
      const ball = new three.Group()
      ball.position.set(s * 0.046, 0.17, 0.1)
      ball.add(mesh(new three.SphereGeometry(0.024, 20, 16), mat('#FFFFFF', 0.3)))
      const iris = mesh(new three.CircleGeometry(0.013, 20), mat(IRIS, 0.3), [0, 0, 0.0241])
      const pupil = mesh(new three.CircleGeometry(0.0065, 16), mat('#140D0A', 0.2), [0, 0, 0.0243])
      const glint = mesh(
        new three.CircleGeometry(0.003, 10),
        new three.MeshBasicMaterial({ color: '#ffffff' }),
        [0.004, 0.005, 0.0245],
      )
      ball.add(iris, pupil, glint)
      head.add(ball)
      const lid = mesh(
        new three.SphereGeometry(0.0255, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
        skin,
        [s * 0.046, 0.17, 0.1],
      )
      head.add(lid)
      eyes.push({ ball, lid })
      const brow = mesh(new three.BoxGeometry(0.052, 0.011, 0.012), hairMat, [
        s * 0.048,
        0.212,
        0.115,
      ])
      head.add(brow)
      brows.push(brow)
    }

    // The mouth: a smile when shut, a dark opening shaped by the vowel when open.
    const smileArc = mesh(
      new three.TorusGeometry(0.028, 0.0045, 8, 20, Math.PI),
      mat(LIP, 0.5),
      [0, 0.098, 0.121],
    )
    smileArc.rotation.z = Math.PI
    head.add(smileArc)
    const opening = mesh(new three.CircleGeometry(1, 28), mat('#5B1E2C', 0.8), [0, 0.092, 0.124])
    const lips = mesh(new three.RingGeometry(0.92, 1.12, 28), mat(LIP, 0.5), [0, 0, 0.0005])
    opening.add(lips)
    head.add(opening)

    return {
      pose(p: Pose) {
        root.rotation.z = -p.lean * D
        chest.scale.x = 1 + 0.012 * p.breath
        const up = p.shrug * 0.04
        left.root.position.y = 0.42 + up
        right.root.position.y = 0.42 + up
        left.pose(p.left)
        right.pose(p.right)
        head.rotation.set(p.head.nod * D, p.head.turn * D, -p.head.tilt * D)
        for (const e of eyes) {
          e.ball.rotation.set(p.gaze[1] * 0.35, p.gaze[0] * 0.45, 0)
          // Lid: tilted back over the eye's top when open, rolled down over its front to blink.
          e.lid.rotation.x = -0.95 + (p.blink + (p.smile > 0.9 ? 0.2 : 0)) * 2.4
        }
        brows.forEach((b, j) => {
          const s = j === 0 ? -1 : 1
          b.position.y = 0.212 + p.brows * 0.014
          b.rotation.z = s * p.brows * -6 * D
        })
        const open = p.mouth > 0.06
        smileArc.visible = !open
        smileArc.scale.set(1, 0.5 + p.smile * 0.7, 1)
        opening.visible = open
        const shape = mouthShape(p.vowel)
        opening.scale.set(0.028 * shape.w, Math.max(0.006, 0.026 * p.mouth * shape.h), 1)
      },
      root,
    }
  },
  name: 'Starter',
  style: '3d',
}
