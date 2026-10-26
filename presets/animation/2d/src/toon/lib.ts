import { spec, type VoiceLine, voiceLines } from '../clock'

/**
 * The 2D look's timing, lip sync and face parts, as SVG strings (the world is 1080×1920). Times are
 * seconds from the first frame; `t` comes from `<ToonStage>`.
 */

export const L: VoiceLine[] = voiceLines
export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
export const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2)
/** 0→1, eased, between times a and b. */
export const ss = (a: number, b: number, t: number) => ease(clamp((t - a) / (b - a)))
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k
/** An overshooting 0→1, for pops. */
export const back = (x: number) => {
  const c = 1.9
  const k = clamp(x)
  return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2
}
/** A seeded random 0..1 (never Math.random: frames must be the same every render). */
export const makeRnd = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647
  return seed / 2147483647
}

/** The video's length in seconds: its length, or the voice plus a second to land. */
export const DURATION = Math.max(spec.lengthSec, (L.at(-1)?.end ?? 0) + 1)
/** Shot cut points: just before each line; S[L.length] is the end. */
export const S: number[] = [...L.map((l, i) => (i === 0 ? 0 : l.start - 0.12)), DURATION]
/** The line (shot) on screen at time t. */
export function lineAt(t: number): number {
  let i = 0
  while (i < L.length - 1 && t >= (S[i + 1] as number)) i++
  return i
}
/** Line i's first word starting with `prefix` (lower case, letters and digits only); throws if
 *  the line has no such word, so a recorded-again line can't silently lose its gesture. */
export function word(i: number, prefix: string): { end: number; start: number; text: string } {
  const w = L[i]?.words.find((x) =>
    x.text.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(prefix),
  )
  if (!w) throw new Error(`No word "${prefix}" in line ${i}`)
  return w
}
export const speaking = (who: string, t: number) =>
  L.some((l) => l.who === who && t >= l.start && t <= l.end)
/** 0..1..0 over 0.16 s once every `period` seconds. */
export const blink = (t: number, period: number, offset: number) => {
  const p = (t + offset) % period
  return p < 0.16 ? Math.sin((p / 0.16) * Math.PI) : 0
}

// ---------- lip sync ----------
const SHAPES = { ah: [1, 0.85], ee: [1.12, 0.48], oo: [0.58, 0.75] } as const
function rawOpen(who: string, t: number): number {
  const line = L.find((l) => l.who === who && t >= l.start && t <= l.end)
  if (!line) return 0
  const f = (t - line.start) * spec.fps
  const i = Math.floor(f)
  const a = line.envelope[i] ?? 0
  const b = line.envelope[i + 1] ?? a
  return lerp(a, b, f - i)
}
function rawShape(who: string, t: number): readonly [number, number] {
  for (const l of L) {
    if (l.who !== who || t < l.start || t > l.end) continue
    const w = l.words.find((x) => t >= x.start && t <= x.end + 0.05)
    if (!w) return SHAPES.ah
    const vowels = w.text.toLowerCase().match(/[aeiouy]/g) ?? ['a']
    const at = Math.floor(((t - w.start) / Math.max(0.05, w.end - w.start)) * vowels.length)
    const v = vowels[Math.min(vowels.length - 1, at)] as string
    return 'ou'.includes(v) ? SHAPES.oo : 'eiy'.includes(v) ? SHAPES.ee : SHAPES.ah
  }
  return SHAPES.ah
}
/** A speaker's mouth at t: how open (loudness), and its width/height shape (the vowel), eased over
 *  the last few 60ths of a second. Draw it with `mouth()`. */
export function mouthAt(who: string, t: number): { hf: number; open: number; wf: number } {
  let open = 0
  let wf = 0
  let hf = 0
  ;[0.4, 0.3, 0.2, 0.1].forEach((k, i) => {
    const tt = t - i / 60
    const sh = rawShape(who, tt)
    open += k * Math.min(1, rawOpen(who, tt) * 1.3)
    wf += k * sh[0]
    hf += k * sh[1]
  })
  return { hf, open, wf }
}

// ---------- SVG parts ----------
let ids = 0
/** A clipPath id, unique within a frame. */
export const uid = (prefix: string) => `${prefix}${ids++}`
export const resetIds = () => {
  ids = 0
}

/** A talking mouth at the origin; `closed` is the SVG path of the shut mouth. */
export function mouth({
  closed,
  inner = '#5B1E2C',
  lip,
  m,
  w,
}: {
  closed: string
  inner?: string
  lip: string
  m: { hf: number; open: number; wf: number }
  w: number
}): string {
  if (m.open < 0.05)
    return `<path d="${closed}" fill="none" stroke="${lip}" stroke-width="${w * 0.13}" stroke-linecap="round" stroke-linejoin="round"/>`
  const mw = w * m.wf
  const mh = Math.max(4, m.open * w * m.hf)
  const x = mw / 2
  const d = `M ${-x},0 Q 0,${-mh * 0.38} ${x},0 Q ${x * 0.9},${mh} 0,${mh * 1.05} Q ${-x * 0.9},${mh} ${-x},0 Z`
  const teeth =
    m.wf > 0.75
      ? `<path d="M ${-x * 0.72},${-mh * 0.08} Q 0,${-mh * 0.3} ${x * 0.72},${-mh * 0.08} L ${x * 0.6},${mh * 0.14} Q 0,${mh * 0.02} ${-x * 0.6},${mh * 0.14} Z" fill="#fff"/>`
      : ''
  const tongue =
    mh > w * 0.25
      ? `<ellipse cx="0" cy="${mh * 0.78}" rx="${mw * 0.3}" ry="${mh * 0.22}" fill="#E26B7C"/>`
      : ''
  const id = uid('mc')
  return `<g><clipPath id="${id}"><path d="${d}"/></clipPath><path d="${d}" fill="${inner}"/><g clip-path="url(#${id})">${teeth}${tongue}</g><path d="${d}" fill="none" stroke="${lip}" stroke-width="${w * 0.07}" stroke-linejoin="round"/></g>`
}

/** An eye: white, an iris following `gaze` [x, y], an upper lid closing by `lid` (0 open .. 1
 *  shut). `lidColor` must match the skin behind the eye. */
export function eye({
  gaze = [0, 0],
  iris,
  lid = 0,
  lidColor,
  line = '#3A2620',
  lineW = 3.5,
  r,
  rx,
  ry,
  x,
  y,
}: {
  gaze?: [number, number]
  iris: string
  lid?: number
  lidColor: string
  line?: string
  lineW?: number
  r: number
  rx: number
  ry: number
  x: number
  y: number
}): string {
  const id = uid('ey')
  const lidY = -ry + clamp(lid) * ry * 2
  return `<g transform="translate(${x},${y})"><clipPath id="${id}"><ellipse rx="${rx}" ry="${ry}"/></clipPath>
    <ellipse rx="${rx}" ry="${ry}" fill="#fff"/>
    <g clip-path="url(#${id})">
      <circle cx="${gaze[0]}" cy="${gaze[1]}" r="${r}" fill="${iris}"/><circle cx="${gaze[0]}" cy="${gaze[1]}" r="${r * 0.52}" fill="#1B120E"/>
      <circle cx="${gaze[0] + r * 0.38}" cy="${gaze[1] - r * 0.42}" r="${r * 0.33}" fill="#fff"/>
      ${lid > 0.01 ? `<rect x="${-rx - 4}" y="${-ry - 4}" width="${rx * 2 + 8}" height="${lidY + ry + 4}" fill="${lidColor}"/>` : ''}
    </g>
    ${lid > 0.01 ? `<path d="M ${-rx},${lidY} Q 0,${lidY + 5} ${rx},${lidY}" fill="none" stroke="${line}" stroke-width="${lineW + 1}" stroke-linecap="round"/>` : ''}
    <ellipse rx="${rx}" ry="${ry}" fill="none" stroke="${line}" stroke-width="${lineW}"/></g>`
}

/** A pill label centred on (x, y); `k` scales it in (0..1). About 0.56 × size per character wide. */
export function chip(
  x: number,
  y: number,
  text: string,
  { bg = '#fff', fg = '#2A2350', k = 1, pad = 28, size = 36 } = {},
): string {
  const w = text.length * size * 0.56 + pad * 2
  return `<g transform="translate(${x},${y}) scale(${k})" opacity="${clamp(k)}"><rect x="${-w / 2}" y="${-size * 1.05}" width="${w}" height="${size * 1.75}" rx="${size * 0.875}" fill="${bg}"/>
    <text x="0" y="${size * 0.3}" text-anchor="middle" font-size="${size}" fill="${fg}" font-family="Fredoka, Arial Rounded MT Bold, system-ui" font-weight="600">${text}</text></g>`
}

/** A world layer seen through the camera {x, y, z}; p < 1 moves less (further away: parallax). */
export function layer(cam: { x: number; y: number; z: number }, p: number, inner: string): string {
  const z = 1 + (cam.z - 1) * p
  const cx = 540 + (cam.x - 540) * p
  const cy = 960 + (cam.y - 960) * p
  return `<g transform="translate(540,960) scale(${z}) translate(${-cx},${-cy})">${inner}</g>`
}
