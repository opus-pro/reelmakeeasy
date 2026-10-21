import fs from 'node:fs'
import path from 'node:path'

import {
  rankingAdvice,
  rankingProblems,
  withRankCount,
} from '@reelmakeeasy/common/ranking/ranking-project'
import {
  applyRankingTemplate,
  missingTemplateSounds,
} from '@reelmakeeasy/common/ranking/ranking-template'
import { storeUri } from '@reelmakeeasy/common/storage/address'
import { filePath, fileStore } from '@reelmakeeasy/common/storage/file-store'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import type { RankingProject, RankingTemplate } from '@shared/types/api/ranking'

import type { SoundLibraryService } from '../sound-library/sound-library.service'

import type { LibraryPrints } from './reference/library-prints'
import {
  analyzeVideo,
  clipMoments,
  downloadYoutube,
  type ReferenceAnalysis,
  youtubeUrl,
} from './reference/reference-video'
import type { RankingService } from './ranking.service'
import {
  AI_CLIP_DEFAULT_SEC,
  AI_CLIP_MAX_SEC,
  AI_CLIP_MIN_SEC,
  AI_CLIPS_MAX,
  aiClipModel,
  clipContactSheet,
  describeAiClipOptions,
  generateAiClip,
} from './ranking-clip-generator'
import type { RankingTemplateService } from './ranking-template.service'

/** What a tool call answers (the agent's `ToolCallResult`). */
type ToolResult = { success: boolean; text: string }

const EXPORT_WAIT_MS = 10 * 60_000
const POLL_MS = 1500

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** The project as the agent reads it: everything it can change, compact. */
function describe(project: RankingProject): string {
  const lines = [
    JSON.stringify({
      id: project.id,
      items: project.items,
      name: project.name,
      reveal: project.reveal,
      sounds: project.sounds,
      stickers: project.stickers ?? [],
      style: project.style,
      title: project.title,
      transition: project.transition,
    }),
  ]
  const problems = rankingProblems(project)
  if (problems.length) lines.push(`Before export: ${problems.join(' ')}`)
  const advice = rankingAdvice(project)
  if (advice.length) lines.push(`Tips: ${advice.join(' ')}`)
  lines.push(`Studio: /ranking?id=${project.id}`)
  return lines.join('\n')
}

/** The tools that make or change a ranking (the chat's preview follows those). */
const FOLLOW_TOOLS = new Set([
  'ranking_add_clip',
  'ranking_add_sticker_image',
  'ranking_apply_style',
  'ranking_create',
  'ranking_export',
  'ranking_generate_clips',
  'ranking_update',
])

const clock = (sec: number) => `${Math.floor(sec / 60)}:${(sec % 60).toFixed(2).padStart(5, '0')}`

/** A reference's analysis as the agent reads it: what to look at, its shots and its sounds. */
function describeAnalysis(a: ReferenceAnalysis, dir: string, librarySize: number): string {
  // Sound effects: off the music's beat, or far louder than it (a beat's kick can look like a boom).
  const effects = a.sounds.filter((s) => !s.onBeat || s.strength >= 0.9)
  const onBeat = a.sounds.length - effects.length
  const sounds = effects.map((s) => {
    const where = s.inShot
      ? ` (shot ${s.inShot.index}, ${s.inShot.secIntoShot.toFixed(2)} s in)`
      : ''
    const what = s.match
      ? `= library "${s.match.name}" (soundId ${s.match.id}, match ${s.match.score})`
      : s.maybe.length
        ? `not clearly in the library; like ${s.maybe.map((m) => `"${m.name}" (soundId ${m.id}, ${m.score})`).join(' or ')}`
        : 'not in the library'
    return `- ${clock(s.atSec)}${where} ${s.description}, ~${s.durationSec} s, strength ${s.strength}${s.onBeat ? ', on the beat' : ''}: ${what}. Frame: ${dir}/${s.frame}`
  })
  const shots = a.shots.map(
    (s, i) =>
      `- shot ${i + 1}: ${s.startSec}-${s.endSec} s (${(s.endSec - s.startSec).toFixed(1)} s). Frame: ${dir}/${s.frame}`,
  )
  return [
    `Analysed ${a.source.title ? `"${a.source.title}"` : a.source.file} (${a.durationSec} s). Files in ${dir}/ (analysis.json has all of it).`,
    `Look at ${dir}/${a.files.titleFrame} (full size: the title band, its words and colours, the rank column, labels, stickers) and ${dir}/${a.files.contactSheet} (16 frames across it), then the frames below where you need detail.`,
    `Shots: ${a.shots.length}, median ${a.medianShotSec ?? '?'} s. A rank is often one shot, sometimes several (a clip with cuts, a transition slide): decide from the frames.`,
    ...shots,
    a.music
      ? `Music: a steady beat at about ${a.music.bpm} BPM runs under it${onBeat ? ` (${onBeat} quieter onsets on that beat are left out below: they are the music, not effects)` : ''}.`
      : 'Music: no steady beat found.',
    `Sound effects (${effects.length}; ${librarySize} library sounds compared):`,
    ...(sounds.length ? sounds : ['- none found']),
    'A sound repeated at each new rank is the reveal sound; one on the impact inside a clip is the action sound. "Not in the library" sounds are ones the user would download themselves: describe them plainly. Never cut sounds out of the reference.',
    'Next: tell the user the pattern in a few lines (ranks, seconds per rank, title look, labels, reveal, stickers, sounds and when they fire), then save it with ranking_style_save.',
  ].join('\n')
}

/** A ranking style as the agent reads it. */
function describeTemplate(t: RankingTemplate): string {
  const missing = missingTemplateSounds(t).map((s) => s.description)
  return [
    JSON.stringify(t),
    missing.length
      ? `Not in the library yet (the user downloads these): ${missing.join('; ')}.`
      : 'Every planned sound is in the library.',
    'Studio: /ranking?tab=styles',
  ].join('\n')
}

/**
 * The Ranking Builder as agent tools (`ranking_*`): the same service the studio uses, so a chat
 * and the studio edit the same project. Clips come from files in the chat's working folder (the
 * user's attachments, or files the agent made there).
 */
export class RankingAgentTools {
  constructor(
    private readonly deps: {
      /** Makes an AI clip (default: the user's text-to-video model) and its contact sheet. */
      ai?: { contactSheet: typeof clipContactSheet; generate: typeof generateAiClip }
      /** A tool read or changed this ranking: the chat now follows it (its preview panel). */
      onRanking?: (sessionId: string, rankingId: string) => void
      /** Library sound fingerprints, for naming a reference's sounds. */
      prints?: Pick<LibraryPrints, 'all'>
      ranking: RankingService
      sounds: Pick<SoundLibraryService, 'add' | 'list'>
      templates?: RankingTemplateService
      /** The chat's working folder (where its attachments are). */
      workingDir: (sessionId: string) => string
    },
  ) {}

  async call(sessionId: string, tool: string, args: unknown): Promise<ToolResult> {
    const a = isRecord(args) ? args : {}
    try {
      const result = await this.dispatch(sessionId, tool, a)
      // A tool that made or changed a ranking: the chat follows it (reading one doesn't move
      // the preview off the one being built).
      const id =
        tool === 'ranking_create' ? /"id":"([\da-f-]{36})"/.exec(result.text)?.[1] : a['id']
      if (result.success && FOLLOW_TOOLS.has(tool) && typeof id === 'string')
        this.deps.onRanking?.(sessionId, id)
      return result
    } catch (error) {
      return { success: false, text: ensureError(error).message }
    }
  }

  /** A file in the chat's working folder (an attachment, or one the agent made) under a rank. */
  private async addClip(
    sessionId: string,
    id: string,
    rank: number,
    file: string,
  ): Promise<ToolResult> {
    const project = this.deps.ranking.get(id)
    const item = project.items.find((i) => i.rank === rank)
    if (!item)
      return {
        success: false,
        text: `There is no rank ${rank}; the ranks are 1-${project.items.length}.`,
      }
    const real = this.workingFile(sessionId, file)
    if (typeof real !== 'string') return real
    const name = path.basename(real)
    const next = await this.deps.ranking.setClip(id, item.id, await this.toTmp(real, name), name)
    const clip = next.items.find((i) => i.id === item.id)?.clip
    return {
      success: true,
      text: `Rank ${rank} now plays ${name} (${clip?.durationSec.toFixed(1)} s long; plays ${clip?.trimStartSec}-${clip?.trimEndSec} s until you trim it).\n${describe(next)}`,
    }
  }

  /** A picture in the chat's working folder, stored with the project for an image sticker. */
  private async addStickerImage(sessionId: string, id: string, file: string): Promise<ToolResult> {
    this.deps.ranking.get(id)
    const real = this.workingFile(sessionId, file)
    if (typeof real !== 'string') return real
    const name = path.basename(real)
    const { imageUrl } = await this.deps.ranking.addStickerImage(
      id,
      await this.toTmp(real, name),
      name,
    )
    return {
      success: true,
      text: `imageUrl: ${imageUrl}\nAdd it with ranking_update: a stickers entry { "id", "kind": "image", "imageUrl": "${imageUrl}", "x", "y", "size" (its width as a share of the frame, e.g. 0.3), "rotation", "rank", "color": "#ffffff" }.`,
    }
  }

  /**
   * Reads a reference Short (a YouTube link, downloaded with yt-dlp, or a video in the working
   * folder) into `references/<name>/`: frames to look at, its shots and its sound effects matched
   * against the library.
   */
  private async analyzeReference(
    sessionId: string,
    url: string,
    file: string,
  ): Promise<ToolResult> {
    if (!url.trim() && !file.trim())
      return { success: false, text: 'Give the YouTube link (url) or a video file (path).' }
    const root = fs.realpathSync(this.deps.workingDir(sessionId))
    const slug = `${new Date().toISOString().slice(0, 19).replace(/\D/g, '')}`
    const dir = path.join(root, 'references', slug)
    let video: string
    let source: { title: null | string; url: null | string }
    if (url.trim()) {
      const link = youtubeUrl(url)
      const downloaded = await downloadYoutube(link, dir)
      video = downloaded.file
      source = { title: downloaded.title, url: link }
    } else {
      const real = this.workingFile(sessionId, file)
      if (typeof real !== 'string') return real
      video = real
      source = { title: path.basename(real), url: null }
    }
    const library = (await this.deps.prints?.all()) ?? []
    const analysis = await analyzeVideo(video, dir, library, source)
    return {
      success: true,
      text: describeAnalysis(analysis, path.relative(root, dir), library.length),
    }
  }

  private applyStyle(id: string, styleId: string): ToolResult {
    const template = this.templates().get(styleId)
    const project = this.deps.ranking.update(
      id,
      applyRankingTemplate(this.deps.ranking.get(id), template),
    )
    const action = template.sounds.onAction.filter((s) => s.soundId)
    return {
      success: true,
      text: [
        `Applied "${template.name}": title colours, overlay colours, reveal (${template.reveal}), transition and the reveal/music sounds.`,
        `Still yours to do per clip: labels (${template.labels.tone || 'short'}), trims to about ${template.perRankSec} s, and a cue on each action with ${action.map((s) => `${s.description} (soundId ${s.soundId})`).join(' or ') || 'a fitting library sound'}${template.stickers.habit ? `; stickers: ${template.stickers.habit}` : ''}.`,
        describe(project),
      ].join('\n'),
    }
  }

  private async dispatch(
    sessionId: string,
    tool: string,
    a: Record<string, unknown>,
  ): Promise<ToolResult> {
    if (tool === 'ranking_list') return this.list()
    if (tool === 'ranking_create') return this.create(String(a['name'] ?? ''), a['ranks'])
    if (tool === 'ranking_get')
      return { success: true, text: describe(this.deps.ranking.get(String(a['id']))) }
    if (tool === 'ranking_update') return this.update(String(a['id']), a['patch'], a['ranks'])
    if (tool === 'ranking_add_sound')
      return await this.addSound(sessionId, String(a['path'] ?? ''), a['name'])
    if (tool === 'ranking_add_clip')
      return await this.addClip(
        sessionId,
        String(a['id']),
        Number(a['rank']),
        String(a['path'] ?? ''),
      )
    if (tool === 'ranking_add_sticker_image')
      return await this.addStickerImage(sessionId, String(a['id']), String(a['path'] ?? ''))
    if (tool === 'ranking_export') return await this.exportNow(String(a['id']))
    if (tool === 'ranking_analyze_reference')
      return await this.analyzeReference(
        sessionId,
        typeof a['url'] === 'string' ? a['url'] : '',
        typeof a['path'] === 'string' ? a['path'] : '',
      )
    if (tool === 'ranking_find_moments') return await this.findMoments(sessionId, a)
    if (tool === 'ranking_generate_clips')
      return await this.generateClips(
        sessionId,
        String(a['id']),
        a['clips'],
        Number(a['seconds'] ?? AI_CLIP_DEFAULT_SEC),
        a['resolution'],
      )
    if (tool === 'ranking_style_list') return this.styleList()
    if (tool === 'ranking_style_get')
      return { success: true, text: describeTemplate(this.templates().get(String(a['id']))) }
    if (tool === 'ranking_style_save')
      return this.styleSave(typeof a['id'] === 'string' ? a['id'] : '', a['style'])
    if (tool === 'ranking_apply_style')
      return this.applyStyle(String(a['id']), String(a['styleId']))
    return { success: false, text: `Unknown tool ${tool}.` }
  }

  /** Exports without the studio, waits for the render, answers where the video is. */
  private async exportNow(id: string): Promise<ToolResult> {
    let status = await this.deps.ranking.exportHeadless(id)
    const end = Date.now() + EXPORT_WAIT_MS
    while (status.state === 'rendering' && Date.now() < end) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      status = this.deps.ranking.renderStatus(status.renderId)
    }
    if (status.state === 'failed')
      return { success: false, text: `The export failed: ${status.error ?? 'unknown error'}` }
    if (status.state !== 'done')
      return { success: false, text: 'The export is still rendering; check the studio.' }
    return {
      success: true,
      text: `Exported: ${status.videoUrl} (1080x1920 MP4). The user can watch and download it in the studio: /ranking?id=${id}`,
    }
  }

  /** A clip's action moments: a file in the working folder, or the clip under a rank. */
  private async findMoments(sessionId: string, a: Record<string, unknown>): Promise<ToolResult> {
    let file: string
    let trim = ''
    if (typeof a['path'] === 'string' && a['path']) {
      const real = this.workingFile(sessionId, a['path'])
      if (typeof real !== 'string') return real
      file = real
    } else {
      const project = this.deps.ranking.get(String(a['id']))
      const item = project.items.find((i) => i.rank === Number(a['rank']))
      if (!item?.clip) return { success: false, text: `Rank ${String(a['rank'])} has no clip yet.` }
      file = filePath(item.clip.url)
      trim = ` It plays ${item.clip.trimStartSec}-${item.clip.trimEndSec} s now; a cue's atSec counts from the trim start.`
    }
    const m = await clipMoments(file)
    const sounds = m.sounds.map(
      (s) => `${s.atSec.toFixed(2)} s ${s.description} (strength ${s.strength})`,
    )
    return {
      success: true,
      text: [
        `${path.basename(file)}: ${m.durationSec} s, times from the file's start.${trim}`,
        `Sound moments (strongest are usually the action): ${sounds.join('; ') || 'none (quiet clip)'}`,
        `Shot changes: ${m.cuts.map((c) => `${c.toFixed(2)} s`).join(', ') || 'none'}`,
        'Trim to start about 1-1.5 s before the action and end about 1 s after it; put the action sound at its moment.',
      ].join('\n'),
    }
  }

  /**
   * Makes AI clips from text, one per rank (in parallel), and puts each under its rank (one at a
   * time: each write reads the project the last one saved). Each gets a contact sheet (a frame
   * every half second) in `generated/` for the agent to see the action and time it.
   */
  private async generateClips(
    sessionId: string,
    id: string,
    raw: unknown,
    seconds: number,
    resolution: unknown,
  ): Promise<ToolResult> {
    let clips: unknown = raw
    if (typeof raw === 'string') {
      try {
        clips = JSON.parse(raw)
      } catch {
        return {
          success: false,
          text: 'clips must be JSON: [{ "rank": 1, "prompt": "..." }, ...].',
        }
      }
    }
    if (!Array.isArray(clips) || !clips.length || clips.length > AI_CLIPS_MAX)
      return {
        success: false,
        text: `Give 1 to ${AI_CLIPS_MAX} clips: [{ "rank": 1, "prompt": "..." }, ...].`,
      }
    const project = this.deps.ranking.get(id)
    const asks: { prompt: string; rank: number }[] = []
    for (const clip of clips) {
      const rank = Number((clip as Record<string, unknown>)?.['rank'])
      const prompt = String((clip as Record<string, unknown>)?.['prompt'] ?? '').trim()
      if (!project.items.some((i) => i.rank === rank))
        return {
          success: false,
          text: `There is no rank ${rank}; the ranks are 1-${project.items.length}.`,
        }
      if (asks.some((x) => x.rank === rank))
        return { success: false, text: `Rank ${rank} is asked for twice.` }
      if (prompt.length < 20 || prompt.length > 1500)
        return {
          success: false,
          text: `Rank ${rank}'s prompt should describe the scene and its action (20-1500 characters).`,
        }
      asks.push({ prompt, rank })
    }
    const sec = Math.round(
      Math.min(
        AI_CLIP_MAX_SEC,
        Math.max(AI_CLIP_MIN_SEC, Number.isFinite(seconds) ? seconds : AI_CLIP_DEFAULT_SEC),
      ),
    )
    const picked = pickedResolution(resolution)
    if (!picked.ok) return { success: false, text: picked.ask(asks.length, sec) }
    const ai = this.deps.ai ?? { contactSheet: clipContactSheet, generate: generateAiClip }
    const root = fs.realpathSync(this.deps.workingDir(sessionId))
    const dir = path.join(root, 'generated')
    fs.mkdirSync(dir, { recursive: true })
    const stamp = Date.now()
    const made = await Promise.allSettled(
      asks.map(async (ask) => {
        const file = path.join(dir, `rank-${ask.rank}-${stamp}.mp4`)
        const result = await ai.generate({
          outputPath: file,
          prompt: ask.prompt,
          resolution: picked.resolution,
          seconds: sec,
        })
        const sheet = file.replace(/\.mp4$/, '-sheet.jpg')
        await ai.contactSheet(file, sheet).catch(() => undefined)
        return { ...ask, ...result, file, sheet: fs.existsSync(sheet) ? sheet : null }
      }),
    )
    const lines: string[] = []
    let spent = 0
    for (const [i, outcome] of made.entries()) {
      const ask = asks[i] as { rank: number }
      if (outcome.status === 'rejected') {
        lines.push(
          `- Rank ${ask.rank}: not made (${ensureError(outcome.reason).message.split('\n')[0]}).`,
        )
        continue
      }
      const clip = outcome.value
      spent += clip.costUsd
      const item = this.deps.ranking.get(id).items.find((it) => it.rank === clip.rank)
      if (item)
        await this.deps.ranking.setClip(
          id,
          item.id,
          await this.toTmp(clip.file, path.basename(clip.file)),
          path.basename(clip.file),
        )
      lines.push(
        `- Rank ${clip.rank}: ${clip.durationSec} s, now under rank ${clip.rank}.${clip.sheet ? ` Frames (every 0.5 s, left to right, two rows): ${path.relative(root, clip.sheet)}` : ''}`,
      )
    }
    const done = made.filter((m) => m.status === 'fulfilled').length
    return {
      success: done > 0,
      text: [
        `Made ${done} of ${asks.length} clips at ${picked.resolution} (about $${spent.toFixed(2)}).`,
        ...lines,
        'Look at each contact sheet: what happens, and when (frame n is at n x 0.5 s). Then re-rank if one came out funnier, trim each to its action, and put a meme sound on the action.',
        describe(this.deps.ranking.get(id)),
      ].join('\n'),
    }
  }

  private list(): ToolResult {
    const rankings = this.deps.ranking
      .list()
      .map((r) => `- ${r.name} (${r.itemCount} ranks) id=${r.id}`)
    const sounds = this.deps.sounds
      .list()
      .map(
        (s) =>
          `- ${s.favorite ? '★ ' : ''}${s.name} (${s.durationSec.toFixed(1)} s${s.uses ? `, used ${s.uses}×` : ''}) id=${s.id}`,
      )
    return {
      success: true,
      text: [
        `Rankings:\n${rankings.join('\n') || '(none yet)'}`,
        `Sound library (starred and most used first):\n${sounds.join('\n') || '(empty: the user adds sounds in Ranking Builder > Sound library)'}`,
      ].join('\n\n'),
    }
  }

  private styleList(): ToolResult {
    const rows = this.templates()
      .list()
      .map(
        (t) =>
          `- ${t.name} (${t.rankCount} ranks, ~${t.perRankSec} s each; ${missingTemplateSounds(t).length} sounds to download) id=${t.id}`,
      )
    return {
      success: true,
      text: `Ranking styles:\n${rows.join('\n') || '(none yet: analyse a reference and save its style)'}`,
    }
  }

  private styleSave(id: string, style: unknown): ToolResult {
    let parsed: unknown = style
    if (typeof style === 'string') {
      try {
        parsed = JSON.parse(style)
      } catch {
        return { success: false, text: "style must be JSON (an object with the style's fields)." }
      }
    }
    const saved = id ? this.templates().update(id, parsed) : this.templates().create(parsed)
    return { success: true, text: `Saved.\n${describeTemplate(saved)}` }
  }

  private templates(): RankingTemplateService {
    if (!this.deps.templates) throw new Error('Ranking styles are not available.')
    return this.deps.templates
  }

  /** Copies a working-folder file into the store's tmp/, where the service takes uploads from. */
  private async toTmp(real: string, name: string): Promise<string> {
    const upload = storeUri(`tmp/agent-ranking/${Date.now()}-${name.replace(/[^\w.-]/g, '_')}`)
    await fileStore.upload(real, upload)
    return upload
  }

  /** A new ranking, with `ranks` ranks when given (5 by default). */
  private create(name: string, ranks: unknown): ToolResult {
    const made = this.deps.ranking.create(name)
    const project =
      typeof ranks === 'number' ? this.deps.ranking.update(made.id, rankCountPatch(made, ranks)) : made
    return { success: true, text: describe(project) }
  }

  /** Changes a ranking: the patch's fields, then the number of ranks when `ranks` is given. */
  private update(id: string, patch: unknown, ranks: unknown): ToolResult {
    let parsed: unknown = patch ?? {}
    if (typeof patch === 'string') {
      try {
        parsed = JSON.parse(patch)
      } catch {
        return { success: false, text: 'patch must be JSON (an object with the fields to change).' }
      }
    }
    let project = this.deps.ranking.update(id, parsed)
    if (typeof ranks === 'number')
      project = this.deps.ranking.update(id, rankCountPatch(project, ranks))
    return { success: true, text: describe(project) }
  }

  /** A sound file the user dropped into the chat (or one in the working folder), into their
   *  sound library. */
  private async addSound(sessionId: string, file: string, name: unknown): Promise<ToolResult> {
    const real = this.workingFile(sessionId, file)
    if (typeof real !== 'string') return real
    const fileName = path.basename(real)
    const given = typeof name === 'string' && name.trim() ? name.trim() : ''
    const sound = await this.deps.sounds.add(
      await this.toTmp(real, fileName),
      given ? `${given}${path.extname(fileName)}` : fileName,
    )
    return {
      success: true,
      text: `Added "${sound.name}" to the sound library (soundId ${sound.id}, ${sound.durationSec} s). It can play now: as the reveal sound, the music bed or an action sound.`,
    }
  }

  /** A file inside the chat's working folder, as a real path, or why it can't be used. */
  private workingFile(sessionId: string, file: string): string | ToolResult {
    const root = fs.realpathSync(this.deps.workingDir(sessionId))
    let real: string
    try {
      real = fs.realpathSync(path.resolve(root, file))
    } catch {
      return { success: false, text: `No file at ${file} in your working folder.` }
    }
    if (!real.startsWith(root + path.sep) || !fs.statSync(real).isFile())
      return {
        success: false,
        text: 'Use a file in your working folder (the chat’s attachments are in attachments/).',
      }
    return real
  }
}

/** The patch that gives a ranking `count` ranks (`withRankCount`): its ranks and reveal order. */
function rankCountPatch(project: RankingProject, count: number): Record<string, unknown> {
  const next = withRankCount(project, count)
  return { items: next.items, reveal: next.reveal, stickers: next.stickers ?? [] }
}

/**
 * The resolution the user picked for AI clips (it sets the quality and the price). Without one,
 * or with one the model doesn't make, nothing is made: the agent gets the choices to put to them.
 */
function pickedResolution(
  raw: unknown,
):
  | { ask: (count: number, seconds: number) => string; ok: false }
  | { ok: true; resolution: string } {
  const resolution = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (resolution && aiClipModel(resolution)) return { ok: true, resolution }
  const unknown = resolution ? `The clip model doesn't make ${resolution} clips. ` : ''
  return {
    ask: (count, seconds) =>
      `${unknown}Ask the user which resolution to make the clips at, then call again with "resolution": ${describeAiClipOptions(count, seconds)}.`,
    ok: false,
  }
}
