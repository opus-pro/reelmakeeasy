import { back, lerp, S, ss } from './lib'

/** Cartoon parts for object characters: stick arms and legs with white gloves, a sparkle, and the
 *  shot framing. SVG strings, like lib.ts. */

export const INK = '#2B2433'

export type Pose = 'fist' | 'open' | 'point' | 'thumb'
/** A hand: where it is (the character's own coordinates), its pose, and an extra turn. */
export type Hand = { pose?: Pose; rot?: number; x: number; y: number }

/** A white cartoon glove; fingers point up at rot 0. */
export function glove(x: number, y: number, rot = 0, pose: Pose = 'open', flip = 1, scale = 1): string {
  const cap = (cx: number, cy: number, len: number, ang: number, r = 8) =>
    `<rect x="${cx - r}" y="${cy - len}" width="${2 * r}" height="${len + r}" rx="${r}" transform="rotate(${ang} ${cx} ${cy})"/>`
  let f = ''
  if (pose === 'open')
    f = [-28, -9, 9, 28].map((a, j) => cap(-12 + j * 8, -10, 26, a)).join('') + cap(16, 2, 18, 72)
  else if (pose === 'point') f = cap(-4, -12, 36, 0) + cap(16, 4, 16, 72)
  else if (pose === 'thumb') f = cap(-10, -10, 28, -8, 9)
  const shapes = `<circle r="22"/>${f}<rect x="-19" y="14" width="38" height="15" rx="6"/>`
  const knuckles =
    pose === 'fist' || pose === 'thumb'
      ? `<path d="M -14,-6 Q -6,-13 2,-6 M 0,6 Q 8,-1 16,6" stroke="#B9B2C8" stroke-width="3" fill="none" stroke-linecap="round"/>`
      : ''
  return `<g transform="translate(${x},${y}) rotate(${rot}) scale(${flip * scale},${scale})">
    <g fill="${INK}" stroke="${INK}" stroke-width="8" stroke-linejoin="round">${shapes}</g><g fill="#fff">${shapes}</g>${knuckles}</g>`
}

/** An arm from shoulder [sx, sy] to hand h; the glove turns to follow the arm. side: -1 left, 1 right. */
export function arm([sx, sy]: [number, number], h: Hand, color: string, side: -1 | 1, width = 13): string {
  const dx = h.x - sx
  const dy = h.y - sy
  const len = Math.hypot(dx, dy) || 1
  const bend = side * 0.18 * len
  const mx = (sx + h.x) / 2 - (dy / len) * bend
  const my = (sy + h.y) / 2 + (dx / len) * bend
  const rot = (Math.atan2(h.y - my, h.x - mx) * 180) / Math.PI + 90 + (h.rot ?? 0)
  return `<path d="M ${sx},${sy} Q ${mx},${my} ${h.x},${h.y}" fill="none" stroke="${INK}" stroke-width="${width + 7}" stroke-linecap="round"/>
    <path d="M ${sx},${sy} Q ${mx},${my} ${h.x},${h.y}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>
    ${glove(h.x, h.y, rot, h.pose ?? 'open', side)}`
}

/** Stick legs at the given x offsets, from `top` down to the feet (origin = the ground). */
export const legs = (xs: number[], top: number, color: string, shoe: string): string =>
  xs
    .map(
      (x) => `<path d="M ${x},${top} L ${x},-8" stroke="${INK}" stroke-width="19" stroke-linecap="round"/>
    <path d="M ${x},${top} L ${x},-8" stroke="${color}" stroke-width="12" stroke-linecap="round"/>
    <ellipse cx="${x + Math.sign(x) * 12}" cy="-6" rx="28" ry="13" fill="${shoe}" stroke="${INK}" stroke-width="5"/>`,
    )
    .join('')

export const sparkle = (x: number, y: number, r: number, op = 1): string =>
  `<path transform="translate(${x},${y})" d="M 0,${-r} Q ${r * 0.18},${-r * 0.18} ${r},0 Q ${r * 0.18},${r * 0.18} 0,${r} Q ${-r * 0.18},${r * 0.18} ${-r},0 Q ${-r * 0.18},${-r * 0.18} 0,${-r} Z" fill="#fff" opacity="${op}"/>`

/** Framing per shot name: `wide: [x, y, z0, z1]`, any other shot `[x, y, z0, z1, punch?]` (punch:
 *  a quick zoom kick on the cut), `end: [[x, y, z], [x, y, z]]` (a 1.8 s move). z0 → z1 over the
 *  shot; a shot without a key uses `wide`. */
export type Frames = {
  [shot: string]: [number, number, number, number, number?] | [[number, number, number], [number, number, number]]
}

export type Cam = { x: number; y: number; z: number }

/** The camera on line i's shot at t, with a slow hand-held drift. */
export function camera(t: number, i: number, shot: string, F: Frames): Cam {
  const a = S[i] as number
  const b = S[i + 1] as number
  const k = ss(a, b, t)
  const hx = Math.sin(t * 0.8) * 4
  const hy = Math.cos(t * 0.63) * 3
  if (shot === 'end' && F['end']) {
    const [p, q] = F['end'] as [[number, number, number], [number, number, number]]
    const k1 = ss(a, a + 1.8, t)
    return {
      x: lerp(p[0], q[0], k1) + hx,
      y: lerp(p[1], q[1], k1) + hy,
      z: lerp(p[2], q[2], k1) - ss(a + 1.8, b, t) * 0.03,
    }
  }
  const f = (F[shot] ?? F['wide']) as [number, number, number, number, number?]
  const punch = f[4] ? f[4] * (back(ss(a, a + 0.3, t)) - ss(a + 0.3, a + 1.2, t)) : 0
  return { x: f[0] + hx, y: f[1] + hy, z: lerp(f[2], f[3], k) + punch }
}
