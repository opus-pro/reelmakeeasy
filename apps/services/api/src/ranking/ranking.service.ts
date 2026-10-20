import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Logger } from '@reelmakeeasy/common/logger'
import {
  newRankingProject,
  rankingProblems,
  rankingTimeline,
  type RankingTimelinePart,
  soundsOf,
  transitionOf,
} from '@reelmakeeasy/common/ranking/ranking-project'
import { keyIsUnder, parseStoreUri, storeUri, toSavedAddress } from '@reelmakeeasy/common/storage/address'
import { dataDir, filePath, fileStore } from '@reelmakeeasy/common/storage/file-store'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import type {
  RankingClip,
  RankingProject,
  RankingProjectSummary,
  RankingRenderStatus,
} from '@shared/types/api/ranking'

import type { SoundLibraryService } from '../sound-library/sound-library.service'

import { applyRankingPatch } from './ranking-patch'
import { probeClip, type RenderPart, renderRanking, type SoundFile } from './ranking-render'

const logger = new Logger('RankingService')

/** Where uploaded clips and renders live in the file store. */
const STORE_FOLDER = 'ranking'
const PROJECT_ID = /^[\da-f-]{36}$/
const CLIP_EXT = new Set(['.m4v', '.mkv', '.mov', '.mp4', '.webm'])
/** A new clip plays this long until the user trims it. */
const DEFAULT_CLIP_SEC = 6
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
      trimEndSec: Math.min(durationSec, DEFAULT_CLIP_SEC),
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
   * Starts a render. `overlays` are the studio's PNGs, one per segment in reveal order, each the
   * full 1080x1920 frame's overlay; `bandHeight` is where the clips start. Answers at once.
   */
  startRender(id: string, body: unknown): RankingRenderStatus {
    const project = this.get(id)
    const problems = rankingProblems(project)
    if (problems.length) throw new RankingInputError(problems.join(' '))
    const timeline = rankingTimeline(project)
    const { bandHeight, overlays } = parseRenderBody(body, timeline.length)
    if ([...this.jobs.values()].some((j) => j.projectId === id && j.state === 'rendering'))
      throw new RankingInputError('This ranking is already rendering.')
    const renderId = randomUUID()
    const job: RenderJob = { progress: 0, projectId: id, renderId, state: 'rendering' }
    this.jobs.set(renderId, job)
    void this.render(project, timeline, bandHeight, overlays, job)
    return publicJob(job)
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
      const parts: RenderPart[] = timeline.map((part, i) => {
        const png = path.join(workDir, `overlay-${i}.png`)
        fs.writeFileSync(png, overlays[i] as Buffer)
        if (part.kind === 'transition')
          return { durSec: part.durSec, kind: 'transition', png, sfx: soundFile(transition.sound) }
        const clip = part.segment.item.clip
        return {
          clipFile: filePath(clip?.url ?? ''),
          durSec: part.durSec,
          kind: 'clip',
          overlay: png,
          sfx: soundFile(sounds.reveal),
          startSec: clip?.trimStartSec ?? 0,
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
export function parseRenderBody(body: unknown, segmentCount: number): { bandHeight: number; overlays: Buffer[] } {
  const b = (body ?? {}) as Record<string, unknown>
  const bandHeight = Number(b['bandHeight'])
  if (!Number.isInteger(bandHeight) || bandHeight < 0 || bandHeight > BAND_MAX)
    throw new RankingInputError('The title band height is missing.')
  const raw = b['overlays']
  if (!Array.isArray(raw) || raw.length !== segmentCount)
    throw new RankingInputError('The overlays are out of date: try the export again.')
  const overlays = raw.map((value) => {
    const data = typeof value === 'string' ? value.replace(/^data:image\/png;base64,/, '') : ''
    const png = Buffer.from(data, 'base64')
    if (png.length < PNG_SIGNATURE.length || !png.subarray(0, 8).equals(PNG_SIGNATURE))
      throw new RankingInputError('An overlay is not a PNG.')
    return png
  })
  return { bandHeight, overlays }
}
