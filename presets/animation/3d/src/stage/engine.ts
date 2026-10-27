import * as THREE from 'three'

export { THREE }

/** The 3D look's engine: a full-resolution, anti-aliased three.js scene with soft studio light, a
 *  dark ground fading into fog, and a 1080×1920 label layer on top. */
export type Engine3D = {
  camera: THREE.PerspectiveCamera
  /** The label layer (2D canvas): `label()` draws on it; cleared every frame. */
  labels: CanvasRenderingContext2D
  render: () => void
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  /** Bring every world matrix up to date (after moving things, before `toScreen`). */
  sync: () => void
  /** A world point as label-layer pixels: [x, y, inFront]. */
  toScreen: (p: THREE.Vector3) => [number, number, boolean]
}

export function createEngine3D({
  background = '#0E1116',
  gl,
  overlay,
}: {
  background?: string
  gl: HTMLCanvasElement
  overlay: HTMLCanvasElement
}): Engine3D {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    canvas: gl,
    preserveDrawingBuffer: true,
  })
  renderer.setPixelRatio(1)
  renderer.setSize(1080, 1920, false)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(background)
  scene.fog = new THREE.Fog(background, 18, 60)
  scene.add(new THREE.HemisphereLight('#DDE6FF', '#20242C', 1.1))
  const key = new THREE.DirectionalLight('#FFF4E5', 2.4)
  key.position.set(6, 12, 8)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  scene.add(key)
  const rim = new THREE.DirectionalLight('#7FB8FF', 1.2)
  rim.position.set(-8, 6, -10)
  scene.add(rim)
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(80, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: background, roughness: 0.95 }),
  )
  ground.receiveShadow = true
  scene.add(ground)
  const camera = new THREE.PerspectiveCamera(35, 1080 / 1920, 0.1, 500)
  const labels = overlay.getContext('2d') as CanvasRenderingContext2D
  const v = new THREE.Vector3()
  return {
    camera,
    labels,
    render: () => renderer.render(scene, camera),
    renderer,
    scene,
    sync: () => {
      scene.updateMatrixWorld(true)
      camera.updateMatrixWorld()
    },
    toScreen: (p) => {
      v.copy(p).project(camera)
      return [(v.x + 1) * 540, (1 - v.y) * 960, v.z < 1]
    },
  }
}

// ---------- helpers ----------
export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const smooth = (x: number) => {
  const k = clamp(x)
  return k * k * (3 - 2 * k)
}
/** 0→1, eased, between times a and b. */
export const ss = (a: number, b: number, t: number) => smooth((t - a) / (b - a))
/** An overshooting 0→1, for pops. */
export const back = (x: number) => {
  const c = 1.7
  const k = clamp(x)
  return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2
}
/** A seeded random 0..1 (never Math.random()). */
export const rng = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647
  return seed / 2147483647
}
/** A studio material: soft, a little glossy. */
export const mat = (color: string, o: { metalness?: number; roughness?: number } = {}) =>
  new THREE.MeshStandardMaterial({
    color,
    metalness: o.metalness ?? 0.1,
    roughness: o.roughness ?? 0.45,
  })
/** A glowing material (unlit): for a part that lights up. `k` 0..1 fades it in. */
export const emissive = (color: string, k = 1) =>
  new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 1.5 * k,
    roughness: 0.4,
  })

/** Camera moves: each sets the camera from t and returns it (always moving; ease with `ss`). */
export const cam = {
  /** Circles `target` at `radius`, `height` up, starting at angle `from` (radians), `speed` rad/s. */
  orbit(
    c: THREE.PerspectiveCamera,
    t: number,
    { from = 0, height = 3, radius = 12, speed = 0.15, target = new THREE.Vector3() } = {},
  ) {
    const a = from + t * speed
    c.position.set(
      target.x + Math.cos(a) * radius,
      target.y + height,
      target.z + Math.sin(a) * radius,
    )
    c.lookAt(target)
    return c
  },
  /** Moves from one position to another between times a and b, looking at `target`. */
  move(
    c: THREE.PerspectiveCamera,
    t: number,
    a: number,
    b: number,
    from: THREE.Vector3,
    to: THREE.Vector3,
    target = new THREE.Vector3(),
  ) {
    c.position.lerpVectors(from, to, ss(a, b, t))
    c.lookAt(target)
    return c
  },
}

/**
 * A label for a point on screen (kept inside the frame's 6% margin) ([px, py] from `toScreen`), offset by [ox, oy], with a leader line
 * and a dot; `k` 0→1 grows it in. Text at least 3% of the height (58 px by default).
 */
export function label(
  g: CanvasRenderingContext2D,
  text: string,
  [px, py]: [number, number, boolean?],
  [ox, oy]: [number, number],
  { color = '#F5F7FA', fontFamily = 'Inter, Helvetica, Arial, sans-serif', k = 1, size = 58 } = {},
): void {
  if (k <= 0.01) return
  const tx = px + ox * clamp(k * 1.4)
  const ty = py + oy * clamp(k * 1.4)
  g.save()
  g.strokeStyle = color
  g.lineWidth = 5
  g.beginPath()
  g.moveTo(px, py)
  g.lineTo(tx, ty)
  g.stroke()
  g.fillStyle = color
  g.beginPath()
  g.arc(px, py, 10, 0, Math.PI * 2)
  g.fill()
  if (k > 0.6) {
    g.globalAlpha = clamp((k - 0.6) / 0.4)
    g.font = `700 ${size}px ${fontFamily}`
    const w = g.measureText(text).width
    // Kept inside a 6% margin, so a label near the edge is never cut off.
    const margin = 1080 * 0.06
    const x0 = clamp(ox < 0 ? tx - w - 28 : tx + 4, margin, 1080 - margin - w - 24)
    g.fillStyle = 'rgba(10,12,18,0.78)'
    g.beginPath()
    g.roundRect(x0, ty - size * 0.75, w + 24, size * 1.5, size * 0.3)
    g.fill()
    g.fillStyle = color
    g.textBaseline = 'middle'
    g.fillText(text, x0 + 12, ty)
  }
  g.restore()
}
