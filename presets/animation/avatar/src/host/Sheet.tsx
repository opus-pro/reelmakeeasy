import { loadFont } from '@remotion/google-fonts/Inter'
import { useLayoutEffect, useRef } from 'react'
import { AbsoluteFill } from 'remotion'

import { avatar as theAvatar } from '../avatar/avatar'
import { THREE } from '../stage'

import type { Avatar, Avatar3D } from './avatar-types'
import { placeAvatar2D } from './Host2D'
import { WAIST_Y } from './Host3D'
import { type Pose, REST, stillPose } from './pose'

/** Either style: the project's avatar.ts may type its avatar as one of them. */
const avatar: Avatar = theAvatar

const { fontFamily } = loadFont('normal', { subsets: ['latin'], weights: ['700'] })

const arm = (gesture: Pose['left']['gesture'], n = 1, since = 0.12) => ({ gesture, k: 1, n, since })

/** The poses the avatar check shows, each with its name. */
export const SHEET_POSES: [string, Pose][] = [
  ['Neutral', stillPose()],
  ['Big smile', stillPose({ smile: 1 })],
  ['Says "ah"', stillPose({ mouth: 0.85, vowel: 'A' })],
  ['Says "oh"', stillPose({ mouth: 0.8, vowel: 'O' })],
  ['Says "ee"', stillPose({ mouth: 0.75, vowel: 'E' })],
  ['Blink', stillPose({ blink: 1 })],
  ['Surprised', stillPose({ brows: 1, mouth: 0.5, smile: 0.1, vowel: 'O' })],
  ['Head turned', stillPose({ head: { nod: 0, tilt: 4, turn: 22 } })],
  ['Open hands', stillPose({ left: arm('open'), mouth: 0.5, right: arm('open'), vowel: 'A' })],
  ['Points right', stillPose({ gaze: [0.8, 0], right: arm('point') })],
  ['Counts 3', stillPose({ right: arm('count', 3) })],
  ['Thumbs up', stillPose({ right: arm('thumb'), smile: 1 })],
  ['Waves', stillPose({ right: arm('wave'), smile: 1 })],
  ['Thinks', stillPose({ gaze: [0.3, -0.7], right: arm('think'), smile: 0.2 })],
  ['Shrugs', stillPose({ brows: 0.8, left: arm('shrug'), right: arm('shrug'), shrug: 1 })],
  [
    'Looks aside',
    stillPose({ gaze: [-0.8, 0], head: { nod: 0, tilt: -3, turn: -10 }, left: REST }),
  ],
]

const SIZE = 1920
const COLS = 4
const TILE = SIZE / COLS

function Label({ text, x, y }: { text: string; x: number; y: number }) {
  return (
    <div
      style={{
        background: 'rgba(10,12,18,.72)',
        borderRadius: 14,
        color: '#fff',
        fontFamily,
        fontSize: 30,
        left: x + 14,
        padding: '4px 14px',
        position: 'absolute',
        top: y + 12,
      }}
    >
      {text}
    </div>
  )
}

/**
 * The avatar check: the avatar in 16 poses (faces, mouths, a blink, every gesture), 4 to a row,
 * each named. ReelMakeEasy renders it for avatar_check; it reads `src/avatar/avatar.ts`.
 */
export function AvatarSheet() {
  return (
    <AbsoluteFill style={{ background: '#2E3440' }}>
      {avatar.style === '2d' ? (
        <Sheet2D />
      ) : (
        <Sheet3D avatar={avatar} tiles={SHEET_POSES} size={SIZE} cols={COLS} />
      )}
      {SHEET_POSES.map(([name], j) => (
        <Label key={name} text={name} x={(j % COLS) * TILE} y={Math.floor(j / COLS) * TILE} />
      ))}
    </AbsoluteFill>
  )
}

function Sheet2D() {
  if (avatar.style !== '2d') return null
  const tiles = SHEET_POSES.map(([, p], j) => {
    const x = (j % COLS) * TILE
    const y = Math.floor(j / COLS) * TILE
    const bg = (j + Math.floor(j / COLS)) % 2 ? '#C9D6E8' : '#DCE6F2'
    return `<rect x="${x}" y="${y}" width="${TILE}" height="${TILE}" fill="${bg}"/><svg x="${x}" y="${y}" width="${TILE}" height="${TILE}" viewBox="0 0 ${TILE} ${TILE}">${placeAvatar2D(avatar, p, { s: 0.34, x: TILE / 2, y: TILE - 6 })}</svg>`
  })
  return (
    <svg
      dangerouslySetInnerHTML={{ __html: tiles.join('') }}
      height={SIZE}
      style={{ inset: 0, position: 'absolute' }}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
    />
  )
}

/** Many poses of a 3D avatar in one canvas: one renderer, a viewport per tile. */
function Sheet3D({
  avatar: a,
  cols,
  size,
  tiles,
  view = 'body',
}: {
  avatar: Avatar3D
  cols: number
  size: number
  tiles: [string, Pose][]
  view?: 'body' | 'face'
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    if (!ref.current) return
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      canvas: ref.current,
      preserveDrawingBuffer: true,
    })
    renderer.setPixelRatio(1)
    renderer.setSize(size, size, false)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.setScissorTest(true)
    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight('#DDE6FF', '#20242C', 1.2))
    const key = new THREE.DirectionalLight('#FFF4E5', 2.4)
    key.position.set(3, 6, 6)
    scene.add(key)
    const rim = new THREE.DirectionalLight('#7FB8FF', 1)
    rim.position.set(-4, 3, -5)
    scene.add(rim)
    const host = a.build(THREE)
    host.root.position.y = WAIST_Y
    scene.add(host.root)
    const tile = size / cols
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50)
    if (view === 'face') {
      camera.position.set(0, WAIST_Y + 0.66, 1.25)
      camera.lookAt(0, WAIST_Y + 0.66, 0)
    } else {
      camera.position.set(0, WAIST_Y + 0.45, 1.75)
      camera.lookAt(0, WAIST_Y + 0.45, 0)
    }
    camera.updateProjectionMatrix()
    tiles.forEach(([, p], j) => {
      const x = (j % cols) * tile
      const y = size - (Math.floor(j / cols) + 1) * tile
      host.pose(p)
      scene.updateMatrixWorld(true)
      renderer.setViewport(x, y, tile, tile)
      renderer.setScissor(x, y, tile, tile)
      renderer.setClearColor((j + Math.floor(j / cols)) % 2 ? '#C9D6E8' : '#DCE6F2')
      renderer.render(scene, camera)
    })
    renderer.dispose()
  }, [a, cols, size, tiles, view])
  return <canvas height={size} ref={ref} style={{ inset: 0, position: 'absolute' }} width={size} />
}

/** The avatar's tile in the library: head and shoulders, smiling, 600×600. */
export function AvatarPreview() {
  if (avatar.style === '3d')
    return (
      <AbsoluteFill>
        <Sheet3D
          avatar={avatar}
          cols={1}
          size={600}
          tiles={[['', stillPose({ smile: 0.8 })]]}
          view="face"
        />
      </AbsoluteFill>
    )
  const svg = `<rect width="600" height="600" fill="#DCE6F2"/>${placeAvatar2D(avatar, stillPose({ smile: 0.8 }), { s: 0.6, x: 300, y: 900 })}`
  return (
    <AbsoluteFill>
      <svg
        dangerouslySetInnerHTML={{ __html: svg }}
        height={600}
        viewBox="0 0 600 600"
        width={600}
      />
    </AbsoluteFill>
  )
}
