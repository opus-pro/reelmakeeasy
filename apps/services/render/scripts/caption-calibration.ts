/**
 * Caption calibration harness (development only; not part of the render service build).
 *
 * Draws the server's caption layer for a transcript or render plan at given timestamps, as
 * full 1080 x 1920 PNGs, so they can be compared with editor (AVEditorEngine) screenshots taken
 * at the same timestamps.
 *
 *   pnpm exec tsx --tsconfig apps/services/render/tsconfig.json \
 *     apps/services/render/scripts/caption-calibration.ts \
 *     --transcript http://localhost:5017/api/long-take-videos/<projectId>/transcript \
 *     --onsets 3 --at 2500,4000 --out /tmp/caption-calibration
 *
 * Options:
 *   --transcript <file|url>  TranscriptData JSON (the editor's pre-export caption source).
 *   --preset <id>            With --transcript: the caption look, classic (default), punch or
 *                            explainer, at its defaults; --kind loop|video (default video).
 *   --plan <file>            A render plan JSON; its `caption-preset://` caption segments are used.
 *   --at <ms,ms,...>         Timeline times to draw.
 *   --onsets <n>             Also draw the first n words at start +0/+40/+80/+120/+160/+300 ms.
 *   --probe <dir>            Engine captures to compare with: every `<name>.json` there
 *                            (`{ atMs, plan, size }`, the plan fed to the engine) is drawn at its
 *                            time and size into `<out>/painter/<name>.png`; next to a
 *                            `<name>.png` engine capture (composited over --bg) it also writes
 *                            `<out>/diff/<name>.png` and the residuals (`<out>/residuals.json`).
 *   --size <WxH>             Frame size (default 1080x1920).
 *   --fonts <dir>            Render font folder (default: unpacked from the preset pack).
 *   --background <png>       Frame background (default: flat grey).
 *   --bg <#rrggbb>           Flat background colour (default #3a3a3a; #808080 for --probe).
 *   --out <dir>              Output folder (default: <tmp>/caption-calibration).
 *
 * Writes caption-<ms>.png per time and frames.json with each frame's word boxes.
 */
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  captionFrameAt,
  type CaptionLayoutSegment,
  type CaptionSegmentLayout,
  layoutCaptionSegment,
} from '@reelmakeeasy/common/adapters/caption/caption-layout'
import { resolveCaptionLook } from '@reelmakeeasy/common/adapters/caption/caption-look'
import {
  type CaptionPainter,
  createCaptionPainter,
  withoutZeroDurationWords,
} from '@reelmakeeasy/common/adapters/caption/caption-painter'
import { transcriptToEditingScriptTextTrack } from '@reelmakeeasy/common/adapters/caption/caption-to-editing-script-text-track'
import { TextAdapter } from '@reelmakeeasy/common/adapters/text-adapter'
import type { TranscriptData } from '@shared/types/agent/transcript'
import { type Canvas, createCanvas, type Image, type ImageData, loadImage } from 'canvas'

const REPO_ROOT = path.resolve(__dirname, '../../../..')
const ONSET_OFFSETS_MS = [0, 40, 80, 120, 160, 300]

type Plan = { tracks: Array<{ segs: CaptionLayoutSegment[] }> }

const planCaptions = (plan: Plan) =>
  plan.tracks.flatMap((t) => t.segs).filter((s) => s.uri?.startsWith('caption-preset://'))

async function captionSegments(args: Record<string, string>): Promise<CaptionLayoutSegment[]> {
  if (args.plan) return planCaptions((await readJson(args.plan)) as Plan)
  if (!args.transcript)
    throw new Error('Pass --transcript <file|url>, --plan <file> or --probe <dir>')
  const body = (await readJson(args.transcript)) as TranscriptData | { data: TranscriptData }
  const transcript = 'data' in body ? body.data : body
  if (!transcript?.segments?.some((segment) => segment.words?.length)) return []
  const kind = args.kind === 'loop' ? 'loop' : 'video'
  const { captionRenderPref } = resolveCaptionLook(args.preset ? { preset: args.preset } : null, {
    aspectRatio: '9:16',
    kind,
  })
  // Every caption layer, bottom first (Explainer's strip under its words), as the export draws.
  const layers = await TextAdapter.genCaptionTextTracks({
    renderPref: captionRenderPref,
    track: transcriptToEditingScriptTextTrack(
      kind === 'loop' ? { ...transcript, captionWindows: 'segment' } : transcript,
    ),
  })
  return layers.flatMap((layer) => layer.segs) as unknown as CaptionLayoutSegment[]
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const [key, inline] = argv[i].replace(/^--/, '').split('=', 2)
    args[key] = inline ?? argv[++i] ?? ''
  }
  return args
}

async function readJson(source: string): Promise<unknown> {
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source)
    if (!res.ok) throw new Error(`${source}: HTTP ${res.status}`)
    return res.json()
  }
  return JSON.parse(fs.readFileSync(source, 'utf8'))
}

/** Unpacks the newest preset pack's render fonts once, into the temp folder. */
function defaultFontsDir(): string {
  const presets = path.join(REPO_ROOT, '.reelmakeeasy', 'presets')
  const version = fs
    .readdirSync(presets)
    .filter((v) => fs.existsSync(path.join(presets, v, 'render', 'fonts.tar.gz')))
    .sort()
    .at(-1)
  if (!version) throw new Error(`No render/fonts.tar.gz under ${presets}; pass --fonts`)
  const target = path.join(os.tmpdir(), `reelmakeeasy-caption-fonts-${version}`)
  if (!fs.existsSync(path.join(target, 'fonts'))) {
    fs.mkdirSync(target, { recursive: true })
    execFileSync('tar', [
      '-xzf',
      path.join(presets, version, 'render', 'fonts.tar.gz'),
      '-C',
      target,
    ])
  }
  return path.join(target, 'fonts')
}

/** Draws every segment on screen at `timeMs` over the background; returns what each drew. */
function drawFrame(
  painter: CaptionPainter,
  layouts: CaptionSegmentLayout[],
  timeMs: number,
  frame: { height: number; width: number },
  background: { color: string; image?: Image },
): { canvas: Canvas; frames: unknown[] } {
  const canvas = createCanvas(frame.width, frame.height)
  const ctx = canvas.getContext('2d')
  if (background.image) ctx.drawImage(background.image, 0, 0, frame.width, frame.height)
  else {
    ctx.fillStyle = background.color
    ctx.fillRect(0, 0, frame.width, frame.height)
  }
  const frames = layouts.flatMap((layout) => {
    const state = captionFrameAt(layout, timeMs, painter.measure)
    if (!state) return []
    painter.place(ctx, layout, state, 0)
    return [
      {
        basePx: (layout.basePt * 4) / 3,
        boxes: state.boxes,
        rotate: state.rotate,
        scaleX: state.scaleX,
        texture: layout.texture,
        words: state.words,
      },
    ]
  })
  return { canvas, frames }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const out = path.resolve(args.out || path.join(os.tmpdir(), 'caption-calibration'))
  fs.mkdirSync(out, { recursive: true })
  const painter = createCaptionPainter(args.fonts ? path.resolve(args.fonts) : defaultFontsDir())
  if (args.probe) return compareWithEngine(painter, path.resolve(args.probe), out, args.bg)

  const size = args.size || '1080x1920'
  const match = /^(\d+)x(\d+)$/.exec(size)
  const [width, height] = match ? [Number(match[1]), Number(match[2])] : [0, 0]
  if (!width || !height) throw new Error(`--size must look like 1080x1920, got "${size}"`)
  const frame = { height, width }

  const segments = (await captionSegments(args)).sort((a, b) => a.in - b.in)
  if (!segments.some((s) => s.texts.length)) {
    throw new Error(
      `No caption words in ${args.plan ?? args.transcript}: the transcript has no words, or the plan no caption-preset:// captions`,
    )
  }
  // As the export draws them: without the words the engine drops.
  const layouts = segments.map((s) =>
    layoutCaptionSegment(withoutZeroDurationWords(s), frame, painter.measure),
  )

  const times = new Set<number>(
    (args.at ? args.at.split(',') : []).filter(Boolean).map((t) => Number(t.trim())),
  )
  const onsets = segments.flatMap((s) => s.texts.map((w) => s.in + w.in))
  for (const start of onsets.slice(0, Number(args.onsets || 0))) {
    for (const offset of ONSET_OFFSETS_MS) times.add(start + offset)
  }
  if (!times.size) throw new Error('Nothing to draw: pass --at and/or --onsets')

  const background = {
    color: args.bg || '#3a3a3a',
    image: args.background ? await loadImage(path.resolve(args.background)) : undefined,
  }
  const report: unknown[] = []
  for (const timeMs of [...times].sort((a, b) => a - b)) {
    const { canvas, frames } = drawFrame(painter, layouts, timeMs, frame, background)
    const file = path.join(out, `caption-${String(Math.round(timeMs)).padStart(6, '0')}.png`)
    fs.writeFileSync(file, canvas.toBuffer('image/png'))
    report.push({ file: path.basename(file), frames, timeMs })
  }
  fs.writeFileSync(path.join(out, 'frames.json'), JSON.stringify(report, null, 2))
  console.log(`Wrote ${times.size} frames to ${out}`)
}

/**
 * Draws each engine probe (`<name>.json`: the plan, time and size the engine drew) with the
 * painter and measures how far the two are apart: box edges and tilt, text extents and line
 * bands, the best whole-pixel shift and the mean difference.
 */
async function compareWithEngine(painter: CaptionPainter, dir: string, out: string, bg?: string) {
  const background = bg || '#808080'
  for (const sub of ['painter', 'diff']) fs.mkdirSync(path.join(out, sub), { recursive: true })
  const names = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort()
  const residuals: Record<string, unknown> = {}
  for (const name of names) {
    const probe = (await readJson(path.join(dir, `${name}.json`))) as {
      atMs: number
      plan: Plan
      size: [number, number]
    }
    const frame = { height: probe.size[1], width: probe.size[0] }
    const segments = planCaptions(probe.plan)
    const layouts = segments.map((s) =>
      layoutCaptionSegment(withoutZeroDurationWords(s), frame, painter.measure),
    )
    const { canvas } = drawFrame(painter, layouts, probe.atMs, frame, { color: background })
    fs.writeFileSync(path.join(out, 'painter', `${name}.png`), canvas.toBuffer('image/png'))
    const engineFile = path.join(dir, `${name}.png`)
    if (!fs.existsSync(engineFile)) continue
    const engine = await imageData(await loadImage(engineFile))
    const ours = canvas.getContext('2d').getImageData(0, 0, frame.width, frame.height)
    const bgRgb = hexRgb(background)
    const colours = (key: 'box' | 'text') =>
      [
        ...new Set(
          segments.flatMap((s) =>
            key === 'box'
              ? (s.style.animationBgColor ?? [])
              : [s.style.fontColor ?? '#ffffff', ...s.texts.flatMap((w) => w.highlightColor ?? [])],
          ),
        ),
      ].map((c) => c.toLowerCase())
    const measureBoth = (colour: string, withTilt: boolean) => {
      const e = colourExtent(engine, hexRgb(colour), bgRgb, withTilt)
      const p = colourExtent(ours, hexRgb(colour), bgRgb, withTilt)
      if (!e || !p) return { engine: e, painter: p }
      return {
        // painter minus engine, px: left, top, right, bottom edges
        edges: [p.x0 - e.x0, p.y0 - e.y0, p.x1 - e.x1, p.y1 - e.y1].map(round2),
        engine: e,
        painter: p,
        tilt: withTilt ? round2((p.tiltDeg ?? 0) - (e.tiltDeg ?? 0)) : undefined,
      }
    }
    const result = {
      boxes: Object.fromEntries(colours('box').map((c) => [c, measureBoth(c, true)])),
      text: Object.fromEntries(colours('text').map((c) => [c, measureBoth(c, false)])),
      ...compare(engine, ours, bgRgb, path.join(out, 'diff', `${name}.png`)),
    }
    residuals[name] = result
    const boxText = Object.entries(result.boxes)
      .map(
        ([c, r]) =>
          `${c} edges ${'edges' in r ? r.edges?.join('/') : '-'} tilt ${'tilt' in r ? r.tilt : '-'}`,
      )
      .join('; ')
    const textText = Object.entries(result.text)
      .map(([c, r]) => `${c} edges ${'edges' in r ? r.edges?.join('/') : '-'}`)
      .join('; ')
    console.log(
      `${name}: shift ${result.shift.dx},${result.shift.dy} mean ${result.meanDiff} | boxes ${boxText || '-'} | text ${textText}`,
    )
  }
  fs.writeFileSync(path.join(out, 'residuals.json'), JSON.stringify(residuals, null, 2))
  console.log(`Wrote ${names.length} painter frames, diffs and residuals.json to ${out}`)
}

const round2 = (n: number) => Math.round(n * 100) / 100

function hexRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
}

async function imageData(image: Image): Promise<ImageData> {
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  return ctx.getImageData(0, 0, image.width, image.height)
}

/**
 * How much of `colour` over the background a pixel holds (0-1), or 0 when the pixel is not a
 * blend of the two (another colour).
 */
type Bounds = { x0: number; x1: number; y0: number; y1: number }

type Coverage = (x: number, y: number) => number
function coverageOf(
  data: Uint8ClampedArray,
  i: number,
  colour: [number, number, number],
  bg: [number, number, number],
): number {
  const d = colour.map((c, k) => c - bg[k])
  const den = d.reduce((s, v) => s + v * v, 0)
  if (!den) return 0
  const t = d.reduce((s, v, k) => s + (data[i + k] - bg[k]) * v, 0) / den
  const off = Math.max(...d.map((v, k) => Math.abs(data[i + k] - (bg[k] + t * v))))
  return off > 40 ? 0 : Math.max(0, Math.min(1, t))
}

/** The pixels at least half covered: their bounds and which rows hold any. */
function halfCovered(cov: Coverage, W: number, H: number) {
  const bounds: Bounds = { x0: W, x1: -1, y0: H, y1: -1 }
  const rows = new Uint8Array(H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (cov(x, y) < 0.5) continue
      rows[y] = 1
      bounds.x0 = Math.min(bounds.x0, x)
      bounds.x1 = Math.max(bounds.x1, x)
      bounds.y0 = Math.min(bounds.y0, y)
      bounds.y1 = Math.max(bounds.y1, y)
    }
  }
  return bounds.x1 < 0 ? undefined : { bounds, rows }
}

/** Runs of covered rows (gaps of up to 2 rows joined): the text lines. */
function rowBands(rows: Uint8Array, { y0, y1 }: Bounds): Array<[number, number]> {
  const bands: Array<[number, number]> = []
  for (let y = y0; y <= y1; y++) {
    if (!rows[y]) continue
    const last = bands.at(-1)
    if (last && last[1] >= y - 2) last[1] = y
    else bands.push([y, y])
  }
  return bands
}

/** The tilt of the top edge (degrees, clockwise positive), fitted over the middle columns. */
function topEdgeTilt(cov: Coverage, edgeAt: Coverage, { x0, x1, y0, y1 }: Bounds) {
  const points: Array<[number, number]> = []
  for (let x = Math.round(x0 + (x1 - x0) / 4); x <= x1 - (x1 - x0) / 4; x += 2) {
    let y = Math.max(0, y0 - 2)
    while (y < y1 && cov(x, y) < 0.5) y++
    if (y < y1) points.push([x, y - 0.5 + (0.5 - edgeAt(x, y - 1))])
  }
  const n = points.length
  if (n <= 2) return undefined
  const mx = points.reduce((sum, pt) => sum + pt[0], 0) / n
  const my = points.reduce((sum, pt) => sum + pt[1], 0) / n
  const sxy = points.reduce((sum, pt) => sum + (pt[0] - mx) * (pt[1] - my), 0)
  const sxx = points.reduce((sum, pt) => sum + (pt[0] - mx) ** 2, 0)
  return round2((Math.atan(sxy / sxx) * 180) / Math.PI)
}

/**
 * The extent of `colour` (pixels at least half covered): sub-pixel left/right/top/bottom edges
 * from the 50% crossings, the line bands, and with `withTilt` the tilt of the top edge.
 */
function colourExtent(
  image: ImageData,
  colour: [number, number, number],
  bg: [number, number, number],
  withTilt: boolean,
) {
  const { data, height: H, width: W } = image
  const cov: Coverage = (x, y) => coverageOf(data, (y * W + x) * 4, colour, bg)
  const covered = halfCovered(cov, W, H)
  if (!covered) return undefined
  const { bounds } = covered
  const { x0, x1, y0, y1 } = bounds
  // Sub-pixel: move each edge by the partial coverage of the pixel beyond it.
  const edgeAt: Coverage = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : cov(x, y))
  const midY = Math.round((y0 + y1) / 2)
  const midX = Math.round((x0 + x1) / 2)
  return {
    bands: rowBands(covered.rows, bounds),
    tiltDeg: withTilt ? topEdgeTilt(cov, edgeAt, bounds) : undefined,
    x0: round2(x0 + 0.5 - edgeAt(x0 - 1, midY)),
    x1: round2(x1 + 0.5 + edgeAt(x1 + 1, midY)),
    y0: round2(y0 + 0.5 - edgeAt(midX, y0 - 1)),
    y1: round2(y1 + 0.5 + edgeAt(midX, y1 + 1)),
  }
}

const luma = (d: Uint8ClampedArray, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]

/**
 * Writes the diff image (engine in red, painter in cyan where they differ) and sums the
 * difference over the caption area (pixels off the background in either frame).
 */
function writeDiff(engine: ImageData, ours: ImageData, bgLuma: number, file: string) {
  const { height: H, width: W } = engine
  const [a, b] = [engine.data, ours.data]
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(W, H)
  const bounds: Bounds = { x0: W, x1: -1, y0: H, y1: -1 }
  let sum = 0
  let area = 0
  for (let i = 0; i < a.length; i += 4) {
    const [la, lb] = [luma(a, i), luma(b, i)]
    const d = Math.max(...[0, 1, 2].map((k) => Math.abs(a[i + k] - b[i + k])))
    if (Math.abs(la - bgLuma) > 8 || Math.abs(lb - bgLuma) > 8) {
      area++
      sum += d
      const [x, y] = [(i / 4) % W, Math.floor(i / 4 / W)]
      Object.assign(bounds, {
        x0: Math.min(bounds.x0, x),
        x1: Math.max(bounds.x1, x),
        y0: Math.min(bounds.y0, y),
        y1: Math.max(bounds.y1, y),
      })
    }
    const grey = Math.round(64 + la / 4)
    img.data.set(
      d > 24 ? [Math.round(la), Math.round(lb * 0.6), Math.round(lb)] : [grey, grey, grey],
      i,
    )
    img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  fs.writeFileSync(file, canvas.toBuffer('image/png'))
  return { bounds, meanDiff: round2(sum / Math.max(1, area)) }
}

/** The whole-pixel shift (up to 6 px) of the painter frame that best matches the engine. */
function bestShift(engine: ImageData, ours: ImageData, { x0, x1, y0, y1 }: Bounds) {
  const { height: H, width: W } = engine
  const reach = 6
  let shift = { dx: 0, dy: 0 }
  let best = Number.POSITIVE_INFINITY
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      let err = 0
      for (let y = Math.max(reach, y0); y <= Math.min(H - reach - 1, y1); y++) {
        for (let x = Math.max(reach, x0); x <= Math.min(W - reach - 1, x1); x++) {
          err += Math.abs(
            luma(engine.data, (y * W + x) * 4) - luma(ours.data, ((y - dy) * W + (x - dx)) * 4),
          )
        }
      }
      if (err < best) [best, shift] = [err, { dx, dy }]
    }
  }
  return shift
}

/**
 * Pixel difference of the engine capture and the painter frame: the mean over the caption
 * area, the best whole-pixel shift, and the diff image.
 */
function compare(engine: ImageData, ours: ImageData, bg: [number, number, number], file: string) {
  const bgLuma = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]
  const { bounds, meanDiff } = writeDiff(engine, ours, bgLuma, file)
  const shift = bounds.x1 < 0 ? { dx: 0, dy: 0 } : bestShift(engine, ours, bounds)
  return { meanDiff, shift }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
