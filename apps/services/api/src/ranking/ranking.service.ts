import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Logger } from '@reelmakeeasy/common/logger'
import {
  newRankingProject,
  RANKING_DEFAULT_CLIP_SEC,
  RANKING_HEIGHT,
  RANKING_WIDTH,
  rankingProblems,
  rankingTimeline,
  type RankingTimelinePart,
  soundsOf,
  transitionOf,
} from '@reelmakeeasy/common/ranking/ranking-project'
import {
  animationOf,
  isMovingSticker,
  STICKER_OUT_SEC,
  stickerMotionExpr,
  stickerWindow,
} from '@reelmakeeasy/common/ranking/ranking-motion'
import { keyIsUnder, parseStoreUri, storeUri, toSavedAddress } from '@reelmakeeasy/common/storage/address'
import { dataDir, filePath, fileStore } from '@reelmakeeasy/common/storage/file-store'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import type {
  RankingClip,
  RankingProject,
  RankingProjectSummary,
  RankingRenderStatus,
  RankingSticker,
} from '@shared/types/api/ranking'

import type { SoundLibraryService } from '../sound-library/sound-library.service'

import { applyRankingPatch } from './ranking-patch'
import { probeClip, type RenderPart, renderRanking, type SoundFile, type StickerLayer } from './ranking-render'

const logger = new Logger('RankingService')

/** Where uploaded clips and renders live in the file store. */
const STORE_FOLDER = 'ranking'
const PROJECT_ID = /^[\da-f-]{36}$/
const CLIP_EXT = new Set(['.m4v', '.mkv', '.mov', '.mp4', '.webm'])
const STICKER_EXT = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp'])
/** The title band height the studio may send (it covers the top of the frame). */
const BAND_MAX = 960
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export class RankingNotFoundError extends Error {}
export class RankingInputError extends Error {}

type RenderJob = RankingRenderStatus & { projectId: string }

/**
 * Ranking Builder projects: saved as JSON in `<DATA_DIR>/ranking/`, clips and renders in the
 * file store under `ranking/<projectId>/`. Renders run here, one at a time per project.
 */
export class RankingService {
  private readonly jobs = new Map<string, RenderJob>()

  constructor(
    private readonly sounds: null | Pick<SoundLibraryService, 'has' | 'playback' | 'recordUse'> = null,
    private readonly root: string = path.join(dataDir(), 'ranking'),
  ) {
    fs.mkdirSync(this.root, { recursive: true })
  }

  list(): RankingProjectSummary[] {
    return fs
      .readdirSync(this.root)
      .filter((name) => name.endsWith('.json'))
      .map((name) => this.read(name.slice(0, -5)))
      .filter((p): p is RankingProject & { lastRender?: string } => p !== null)
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((p) => ({
        id: p.id,
        itemCount: p.items.length,
        lastRenderUrl: p.lastRender ?? null,
        name: p.name,
        updatedAt: p.updatedAt,
      }))
  }

  create(name?: string): RankingProject {
    const now = new Date().toISOString()
    const project = newRankingProject(randomUUID(), now, name?.trim() || undefined)
    this.write(project)
    return project
  }

  get(id: string): RankingProject {
    const project = this.read(id)
    if (!project) throw new RankingNotFoundError(`No ranking ${id}`)
    return project
  }

  update(id: string, patch: unknown): RankingProject {
    const next = applyRankingPatch(
      this.get(id),
      patch,
      new Date().toISOString(),
      (soundId) => this.sounds?.has(soundId) ?? false,
    )
    this.write(next)
    return next
  }

  delete(id: string): void {
    this.get(id)
    fs.rmSync(this.file(id), { force: true })
  }

  /**
   * Puts an uploaded video under a rank: the upload (`store://tmp/...`, from a signed upload) is
   * copied into the project's clips, probed, and set to play its first seconds.
   */
  async setClip(id: string, itemId: string, upload: unknown, name: unknown): Promise<RankingProject> {
    const project = this.get(id)
    const item = project.items.find((i) => i.id === itemId)
    if (!item) throw new RankingInputError('That rank is gone: reload the page.')
    const source = typeof upload === 'string' ? toSavedAddress(upload) : ''
    let key: string
    try {
      key = parseStoreUri(source)
    } catch {
      throw new RankingInputError('Upload the clip first.')
    }
    if (!keyIsUnder(key, 'tmp')) throw new RankingInputError('Upload the clip first.')
    const fileName = typeof name === 'string' && name.trim() ? path.basename(name.trim()).slice(0, 120) : 'clip.mp4'
    const ext = path.extname(fileName).toLowerCase()
    if (!CLIP_EXT.has(ext)) throw new RankingInputError('Use a video: mp4, mov, webm, mkv or m4v.')
    const target = storeUri(`${STORE_FOLDER}/${id}/clips/${item.id}-${Date.now()}${ext}`)
    await fileStore.file(source).copyTo(target)
    let probe: { durationSec: number }
    try {
      probe = await probeClip(filePath(target))
    } catch (error) {
      await fileStore.file(target).delete({ ignoreNotFound: true })
      throw new RankingInputError(ensureError(error).message)
    }
    const durationSec = Math.round(probe.durationSec * 100) / 100
    const clip: RankingClip = {
      durationSec,
      name: fileName,
      trimEndSec: Math.min(durationSec, RANKING_DEFAULT_CLIP_SEC),
      trimStartSec: 0,
      url: target,
    }
    const next = {
      ...project,
      items: project.items.map((i) => (i.id === itemId ? { ...i, clip } : i)),
      updatedAt: new Date().toISOString(),
    }
    this.write(next)
    return next
  }

  /**
   * Stores a picture for a sticker (an upload, `store://tmp/...`) in the project's sticker folder
   * and answers its address; placing it is a normal edit (`stickers`).
   */
  async addStickerImage(id: string, upload: unknown, name: unknown): Promise<{ imageUrl: string }> {
    this.get(id)
    const source = typeof upload === 'string' ? toSavedAddress(upload) : ''
    let key: string
    try {
      key = parseStoreUri(source)
    } catch {
      throw new RankingInputError('Upload the picture first.')
    }
    if (!keyIsUnder(key, 'tmp')) throw new RankingInputError('Upload the picture first.')
    const ext = path.extname(typeof name === 'string' ? name : '').toLowerCase()
    if (!STICKER_EXT.has(ext)) throw new RankingInputError('Use a picture: png, jpg, webp or gif.')
    const target = storeUri(`${STORE_FOLDER}/${id}/stickers/${randomUUID()}${ext}`)
    await fileStore.file(source).copyTo(target)
    return { imageUrl: target }
  }

  /**
   * Starts a render. `overlays` are the studio's PNGs, one per segment in reveal order, each the
   * full 1080x1920 frame's overlay; `bandHeight` is where the clips start. Answers at once.
   */
  startRender(id: string, body: unknown): RankingRenderStatus {
    const project = this.get(id)
    const problems = rankingProblems(project)
    if (problems.length) throw new RankingInputError(problems.join(' '))
    const timeline = rankingTimeline(project)
    const { bandHeight, overlays, stickers } = parseRenderBody(body, timeline.length, project)
    if ([...this.jobs.values()].some((j) => j.projectId === id && j.state === 'rendering'))
      throw new RankingInputError('This ranking is already rendering.')
    const renderId = randomUUID()
    const job: RenderJob = { progress: 0, projectId: id, renderId, state: 'rendering' }
    this.jobs.set(renderId, job)
    void this.render(project, timeline, bandHeight, overlays, job, stickers)
    return publicJob(job)
  }

  /**
   * Exports without a studio open (an agent asked): opens the web app's render page in a
   * headless browser, which draws the overlays as the studio does (font, colour emoji, pictures)
   * and starts the render. Answers the render's status (poll `renderStatus` until done).
   */
  async exportHeadless(id: string): Promise<RankingRenderStatus> {
    const project = this.get(id)
    const problems = rankingProblems(project)
    if (problems.length) throw new RankingInputError(problems.join(' '))
    const { chromium } = await import('playwright')
    const launch = async () => {
      const executablePath = process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'] || undefined
      try {
        return await chromium.launch({ executablePath, headless: true })
      } catch {
        // No Playwright browser downloaded: the user's own Chrome.
        return await chromium.launch({ channel: 'chrome', headless: true })
      }
    }
    let browser
    try {
      browser = await launch()
    } catch {
      throw new RankingInputError(
        'Exporting without the studio needs Google Chrome (or `npx playwright install chromium`). Open the ranking in the studio and press Export instead.',
      )
    }
    try {
      const page = await browser.newPage()
      const webPort = Number(process.env['WEB_PORT']) || 3000
      await page.goto(`http://localhost:${webPort}/ranking/render?id=${encodeURIComponent(id)}`, {
        timeout: 120_000,
      })
      const marker = await page.waitForSelector('#ranking-render[data-render-id], #ranking-render[data-render-error]', {
        timeout: 120_000,
      })
      const error = await marker.getAttribute('data-render-error')
      if (error) throw new RankingInputError(error)
      const renderId = (await marker.getAttribute('data-render-id')) ?? ''
      return this.renderStatus(renderId)
    } finally {
      await browser.close()
    }
  }

  renderStatus(renderId: string): RankingRenderStatus {
    const job = this.jobs.get(renderId)
    if (!job) throw new RankingNotFoundError('No such render (it may have been lost in a restart).')
    return publicJob(job)
  }

  private async render(
    project: RankingProject,
    timeline: RankingTimelinePart[],
    bandHeight: number,
    overlays: Buffer[],
    job: RenderJob,
    stickerPngs: ReadonlyMap<string, Buffer> = new Map(),
  ): Promise<void> {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ranking-render-'))
    try {
      const sounds = soundsOf(project)
      const transition = transitionOf(project)
      const used = new Set<string>()
      // A sound that's gone from the library is skipped, not an error: the short still renders.
      const soundFile = (id: null | string): SoundFile | undefined => {
        if (!id || !this.sounds?.has(id)) return undefined
        used.add(id)
        return this.sounds.playback(id)
      }
      const total = timeline.reduce((sum, part) => sum + part.durSec, 0)
      const parts: RenderPart[] = timeline.map((part, i) => {
        const png = path.join(workDir, `overlay-${i}.png`)
        fs.writeFileSync(png, overlays[i] as Buffer)
        if (part.kind === 'transition')
          return { durSec: part.durSec, kind: 'transition', png, sfx: soundFile(transition.sound) }
        const { item } = part.segment
        const clip = item.clip
        // The reveal sound as the clip starts, then this rank's own cues.
        const cues = [
          { atSec: 0, soundId: sounds.reveal },
          ...(item.cues ?? []).map((cue) => ({ atSec: cue.atSec, soundId: cue.soundId })),
        ].flatMap(({ atSec, soundId }) => {
          const sound = soundFile(soundId)
          return sound ? [{ atSec, sound }] : []
        })
        return {
          clipFile: filePath(clip?.url ?? ''),
          cues,
          durSec: part.durSec,
          kind: 'clip',
          overlay: png,
          startSec: clip?.trimStartSec ?? 0,
          stickers: stickerLayers(project, part, total, (sticker) => {
            const image = stickerPngs.get(sticker.id)
            if (!image) return undefined
            const file = path.join(workDir, `sticker-${sticker.id}.png`)
            if (!fs.existsSync(file)) fs.writeFileSync(file, image)
            return file
          }),
        }
      })
      const musicFile = soundFile(sounds.music)
      const out = path.join(workDir, 'ranking.mp4')
      await renderRanking({
        bandHeight,
        ...(musicFile ? { music: { level: sounds.musicVolume, sound: musicFile } } : {}),
        onProgress: (p) => {
          job.progress = Math.round(p * 100) / 100
        },
        out,
        parts,
        workDir,
      })
      const target = storeUri(`${STORE_FOLDER}/${project.id}/renders/${job.renderId}.mp4`)
      await fileStore.upload(out, target)
      job.videoUrl = target
      job.state = 'done'
      this.sounds?.recordUse(used)
      const saved = this.read(project.id)
      if (saved) this.write({ ...saved, lastRender: target } as RankingProject)
    } catch (error) {
      logger.warn(`Ranking render ${job.renderId} failed: ${ensureError(error).message}`)
      job.state = 'failed'
      job.error = ensureError(error).message.split('\n')[0]?.slice(0, 300) ?? 'The render failed.'
    } finally {
      fs.rmSync(workDir, { force: true, recursive: true })
    }
  }

  private file(id: string): string {
    if (!PROJECT_ID.test(id)) throw new RankingNotFoundError(`No ranking ${id}`)
    return path.join(this.root, `${id}.json`)
  }

  private read(id: string): (RankingProject & { lastRender?: string }) | null {
    try {
      return JSON.parse(fs.readFileSync(this.file(id), 'utf8')) as RankingProject
    } catch {
      return null
    }
  }

  private write(project: RankingProject): void {
    const file = this.file(project.id)
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, `${JSON.stringify(project, null, 1)}\n`)
    fs.renameSync(tmp, file)
  }
}

const publicJob = ({ projectId: _projectId, ...job }: RenderJob): RankingRenderStatus => ({ ...job })

/** The render request: one PNG per timeline part (clip overlay or transition slide; base64, as
 *  data URLs or bare), and the band height. */
export function parseRenderBody(
  body: unknown,
  segmentCount: number,
  project?: RankingProject,
): { bandHeight: number; overlays: Buffer[]; stickers: Map<string, Buffer> } {
  const b = (body ?? {}) as Record<string, unknown>
  const bandHeight = Number(b['bandHeight'])
  if (!Number.isInteger(bandHeight) || bandHeight < 0 || bandHeight > BAND_MAX)
    throw new RankingInputError('The title band height is missing.')
  const raw = b['overlays']
  if (!Array.isArray(raw) || raw.length !== segmentCount)
    throw new RankingInputError('The overlays are out of date: try the export again.')
  const overlays = raw.map((value) => pngOf(value, 'An overlay'))
  // Moving stickers' pictures, by sticker id (only this project's moving stickers).
  const stickers = new Map<string, Buffer>()
  const sent = b['stickers']
  if (sent && typeof sent === 'object' && project) {
    const moving = new Set((project.stickers ?? []).filter(isMovingSticker).map((st) => st.id))
    for (const [id, value] of Object.entries(sent as Record<string, unknown>))
      if (moving.has(id)) stickers.set(id, pngOf(value, 'A sticker'))
  }
  return { bandHeight, overlays, stickers }
}

function pngOf(value: unknown, what: string): Buffer {
  const data = typeof value === 'string' ? value.replace(/^data:image\/png;base64,/, '') : ''
  const png = Buffer.from(data, 'base64')
  if (png.length < PNG_SIGNATURE.length || !png.subarray(0, 8).equals(PNG_SIGNATURE))
    throw new RankingInputError(`${what} is not a PNG.`)
  return png
}

/**
 * The moving stickers over one clip part, as render layers: its rank's (on the clip's clock) and
 * the whole short's (on the short's clock, `total` long), each in the part's own seconds. `png`
 * gives a sticker's picture file (undefined: the studio sent none, so it is left out).
 */
export function stickerLayers(
  project: RankingProject,
  part: Extract<RankingTimelinePart, { kind: 'clip' }>,
  total: number,
  png: (sticker: RankingSticker) => string | undefined,
): StickerLayer[] {
  const layers: StickerLayer[] = []
  for (const sticker of project.stickers ?? []) {
    if (!isMovingSticker(sticker)) continue
    const own = sticker.rank === part.segment.item.rank
    if (!own && sticker.rank !== null) continue
    // Its clock: the clip's, or the short's (this part starts `offset` into it).
    const offset = own ? 0 : part.startSec
    const window = stickerWindow(sticker, own ? part.durSec : total)
    if (!window) continue
    const from = Math.max(0, window.start - offset)
    const to = Math.min(part.durSec, window.end - offset)
    if (to <= from) continue
    const file = png(sticker)
    if (!file) continue
    const animation = animationOf(sticker)
    const fadeIn = window.start - offset
    const fadeOut = window.end - STICKER_OUT_SEC - offset
    const shift = round3(offset - window.start)
    layers.push({
      cx: Math.round(sticker.x * RANKING_WIDTH),
      cy: Math.round(sticker.y * RANKING_HEIGHT),
      ...(animation.in === 'fade' && fadeIn >= 0 ? { fadeIn: round3(fadeIn) } : {}),
      ...(animation.out === 'fade' && fadeOut >= 0 && fadeOut < part.durSec ? { fadeOut: round3(fadeOut) } : {}),
      from: round3(from),
      motion: stickerMotionExpr(sticker, `(t${shift >= 0 ? '+' : ''}${shift})`, window.end - window.start),
      png: file,
      to: round3(to),
    })
  }
  return layers
}

const round3 = (n: number) => Math.round(n * 1000) / 1000
