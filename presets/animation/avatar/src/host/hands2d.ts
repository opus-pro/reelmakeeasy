import type { ArmPose, Gesture } from './pose'

/**
 * Arms and hands for a 2D avatar, as SVG strings in the avatar's own box (origin at the bottom
 * centre, y up is negative). `armFor` works out where the elbow and the hand go for a gesture; `drawArm` draws the sleeve and a cartoon hand in the avatar's skin colour.
 */

export type HandShape = 'count' | 'fist' | 'open' | 'point' | 'rest' | 'thumb'

export type HandAt = {
  /** Where the elbow is (the arm bends there; a forearm toward the camera looks short). */
  elbow: [number, number]
  n: number
  rot: number
  shape: HandShape
  x: number
  y: number
}

type Target = { dx: number; dy: number; ex: number; ey: number; rot: number; shape: HandShape }

/** Where the elbow (ex, ey) and the hand (dx, dy) sit for each gesture, from the shoulder
 *  (side 1 = the screen's right). Elbows stay low, by the body, as a person's do. */
const TARGETS: Record<Gesture, (side: number, since: number) => Target> = {
  count: (s) => ({ dx: s * 75, dy: -120, ex: s * 115, ey: 255, rot: s * -6, shape: 'count' }),
  open: (s) => ({ dx: s * 185, dy: 175, ex: s * 85, ey: 285, rot: s * 32, shape: 'open' }),
  point: (s) => ({ dx: s * 300, dy: -20, ex: s * 160, ey: 190, rot: s * 82, shape: 'point' }),
  rest: (s) => ({ dx: s * 55, dy: 560, ex: s * 45, ey: 300, rot: 180 - s * 8, shape: 'rest' }),
  shrug: (s) => ({ dx: s * 240, dy: 215, ex: s * 90, ey: 265, rot: s * 78, shape: 'open' }),
  think: (s) => ({ dx: -s * 150, dy: -135, ex: s * 10, ey: 235, rot: -s * 25, shape: 'fist' }),
  thumb: (s) => ({ dx: s * 140, dy: 70, ex: s * 95, ey: 285, rot: s * 4, shape: 'thumb' }),
  wave: (s, since) => ({
    dx: s * 200,
    dy: -290,
    ex: s * 195,
    ey: 175,
    rot: s * (8 + 18 * Math.sin(since * 9)),
    shape: 'open',
  }),
}

/** One arm's elbow and hand for its pose: eased from rest into the gesture by `a.k`. `side` is
 *  -1 for the screen's left arm, 1 for the right. `scale` sizes the reach to the avatar (1 =
 *  shoulders about 430 apart). */
export function armFor(side: -1 | 1, a: ArmPose, [sx, sy]: [number, number], scale = 1): HandAt {
  const rest = TARGETS.rest(side, 0)
  const to = TARGETS[a.gesture](side, a.since)
  const k = a.gesture === 'rest' ? 0 : a.k
  const mix = (key: 'dx' | 'dy' | 'ex' | 'ey' | 'rot') => rest[key] + (to[key] - rest[key]) * k
  return {
    elbow: [sx + mix('ex') * scale, sy + mix('ey') * scale],
    n: a.n,
    rot: mix('rot'),
    shape: k > 0.45 ? to.shape : rest.shape,
    x: sx + mix('dx') * scale,
    y: sy + mix('dy') * scale,
  }
}

/** A capsule (a finger) from (cx, cy) pointing up `len`, turned `ang` degrees. */
const finger = (cx: number, cy: number, len: number, ang: number, r: number) =>
  `<rect x="${cx - r}" y="${cy - len}" width="${2 * r}" height="${len + r}" rx="${r}" transform="rotate(${ang} ${cx} ${cy})"/>`

/** A cartoon hand at (x, y), fingers up at rot 0, in the skin colour with an `ink` outline. `flip`
 *  -1 mirrors it (the screen's left hand). */
export function hand(
  { n, rot, shape, x, y }: HandAt,
  {
    flip = 1,
    ink = '#2B2433',
    scale = 1,
    skin,
  }: { flip?: number; ink?: string; scale?: number; skin: string },
): string {
  const r = 11
  const xs = [-19, -6.5, 6.5, 19]
  let f = ''
  let thumb = finger(-30, 6, 26, -55, 12)
  if (shape === 'open')
    f = xs.map((fx, j) => finger(fx, -22, 40 - Math.abs(j - 1.5) * 4, -12 + j * 8, r)).join('')
  else if (shape === 'rest') {
    f = xs.map((fx, j) => finger(fx * 0.8, -22, 36 - Math.abs(j - 1.5) * 4, 0, r)).join('')
    thumb = finger(-26, 4, 20, -25, 11)
  } else if (shape === 'point') {
    f =
      finger(-19, -22, 54, -4, r) +
      xs
        .slice(1)
        .map((fx) => `<circle cx="${fx}" cy="-24" r="${r + 1}"/>`)
        .join('')
    thumb = finger(-24, 0, 14, -70, 11)
  } else if (shape === 'count') {
    const up = Math.max(1, Math.min(5, n))
    f = xs
      .map((fx, j) =>
        j < Math.min(up, 4)
          ? finger(fx, -22, 44 - j * 3, -6 + j * 4, r)
          : `<circle cx="${fx}" cy="-24" r="${r + 1}"/>`,
      )
      .join('')
    thumb = up >= 5 ? finger(-30, 6, 28, -50, 12) : finger(-24, 0, 14, -70, 11)
  } else if (shape === 'thumb') {
    f = xs.map((fx) => `<circle cx="${fx * 0.9 + 6}" cy="-14" r="${r + 2}"/>`).join('')
    thumb = finger(-26, -20, 46, -4, 12)
  } else if (shape === 'fist') {
    f = xs.map((fx) => `<circle cx="${fx}" cy="-24" r="${r + 1}"/>`).join('')
    thumb = finger(-24, 0, 14, -70, 11)
  }
  const shapes = `<ellipse cx="0" cy="0" rx="32" ry="34"/>${f}${thumb}`
  return `<g transform="translate(${x},${y}) rotate(${rot}) scale(${flip * scale},${scale})"><g fill="${ink}" stroke="${ink}" stroke-width="7" stroke-linejoin="round">${shapes}</g><g fill="${skin}">${shapes}</g></g>`
}

/**
 * One arm, shoulder to hand: a sleeve (upper arm and forearm, `width` wide) with a cuff, and the
 * hand. Draw arms after the body; a raised hand (count, think, wave) goes over the face, so draw
 * the arms last.
 */
export function drawArm(
  side: -1 | 1,
  a: ArmPose,
  shoulder: [number, number],
  o: {
    cuff?: string
    /** The hand's size against the arm (1.35 by default). */
    hand?: number
    ink?: string
    scale?: number
    skin: string
    sleeve: string
    width?: number
  },
): string {
  const scale = o.scale ?? 1
  const ink = o.ink ?? '#2B2433'
  const w = (o.width ?? 74) * scale
  const h = armFor(side, a, shoulder, scale)
  const handScale = scale * (o.hand ?? 1.35)
  // The wrist: below the palm in the hand's own turn (fingers point up at rot 0).
  const rad = (h.rot * Math.PI) / 180
  const wrist: [number, number] = [
    h.x - Math.sin(rad) * 36 * handScale,
    h.y + Math.cos(rad) * 36 * handScale,
  ]
  const [ex, ey] = h.elbow
  const path = `M ${shoulder[0]},${shoulder[1]} L ${ex},${ey} L ${wrist[0]},${wrist[1]}`
  return [
    `<path d="${path}" fill="none" stroke="${ink}" stroke-width="${w + 9}" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<path d="${path}" fill="none" stroke="${o.sleeve}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`,
    o.cuff
      ? `<circle cx="${wrist[0]}" cy="${wrist[1]}" r="${w * 0.42}" fill="${o.cuff}" stroke="${ink}" stroke-width="5"/>`
      : '',
    // The thumb points in toward the body.
    hand(h, { flip: side === 1 ? 1 : -1, ink, scale: handScale, skin: o.skin }),
  ].join('')
}
