import fs from 'node:fs'
import path from 'node:path'

import { rankingAdvice, rankingProblems } from '@reelmakeeasy/common/ranking/ranking-project'
import { storeUri } from '@reelmakeeasy/common/storage/address'
import { fileStore } from '@reelmakeeasy/common/storage/file-store'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import type { RankingProject } from '@shared/types/api/ranking'

import type { SoundLibraryService } from '../sound-library/sound-library.service'

import type { RankingService } from './ranking.service'

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

/**
 * The Ranking Builder as agent tools (`ranking_*`): the same service the studio uses, so a chat
 * and the studio edit the same project. Clips come from files in the chat's working folder (the
 * user's attachments, or files the agent made there).
 */
export class RankingAgentTools {
  constructor(
    private readonly deps: {
      ranking: RankingService
      sounds: Pick<SoundLibraryService, 'list'>
      /** The chat's working folder (where its attachments are). */
      workingDir: (sessionId: string) => string
    },
  ) {}

  async call(sessionId: string, tool: string, args: unknown): Promise<ToolResult> {
    const a = isRecord(args) ? args : {}
    try {
      if (tool === 'ranking_list') return this.list()
      if (tool === 'ranking_create')
        return { success: true, text: describe(this.deps.ranking.create(String(a['name'] ?? ''))) }
      if (tool === 'ranking_get') return { success: true, text: describe(this.deps.ranking.get(String(a['id']))) }
      if (tool === 'ranking_update') return this.update(String(a['id']), a['patch'])
      if (tool === 'ranking_add_clip')
        return await this.addClip(sessionId, String(a['id']), Number(a['rank']), String(a['path'] ?? ''))
      if (tool === 'ranking_add_sticker_image')
        return await this.addStickerImage(sessionId, String(a['id']), String(a['path'] ?? ''))
      if (tool === 'ranking_export') return await this.exportNow(String(a['id']))
      return { success: false, text: `Unknown tool ${tool}.` }
    } catch (error) {
      return { success: false, text: ensureError(error).message }
    }
  }

  private list(): ToolResult {
    const rankings = this.deps.ranking.list().map((r) => `- ${r.name} (${r.itemCount} ranks) id=${r.id}`)
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

  private update(id: string, patch: unknown): ToolResult {
    let parsed: unknown = patch
    if (typeof patch === 'string') {
      try {
        parsed = JSON.parse(patch)
      } catch {
        return { success: false, text: 'patch must be JSON (an object with the fields to change).' }
      }
    }
    return { success: true, text: describe(this.deps.ranking.update(id, parsed)) }
  }

  /** A file in the chat's working folder (an attachment, or one the agent made) under a rank. */
  private async addClip(sessionId: string, id: string, rank: number, file: string): Promise<ToolResult> {
    const project = this.deps.ranking.get(id)
    const item = project.items.find((i) => i.rank === rank)
    if (!item) return { success: false, text: `There is no rank ${rank}; the ranks are 1-${project.items.length}.` }
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
    const { imageUrl } = await this.deps.ranking.addStickerImage(id, await this.toTmp(real, name), name)
    return {
      success: true,
      text: `imageUrl: ${imageUrl}\nAdd it with ranking_update: a stickers entry { "id", "kind": "image", "imageUrl": "${imageUrl}", "x", "y", "size" (its width as a share of the frame, e.g. 0.3), "rotation", "rank", "color": "#ffffff" }.`,
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
      return { success: false, text: 'Use a file in your working folder (the chat’s attachments are in attachments/).' }
    return real
  }

  /** Copies a working-folder file into the store's tmp/, where the service takes uploads from. */
  private async toTmp(real: string, name: string): Promise<string> {
    const upload = storeUri(`tmp/agent-ranking/${Date.now()}-${name.replace(/[^\w.-]/g, '_')}`)
    await fileStore.upload(real, upload)
    return upload
  }

  /** Exports without the studio, waits for the render, answers where the video is. */
  private async exportNow(id: string): Promise<ToolResult> {
    let status = await this.deps.ranking.exportHeadless(id)
    const end = Date.now() + EXPORT_WAIT_MS
    while (status.state === 'rendering' && Date.now() < end) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      status = this.deps.ranking.renderStatus(status.renderId)
    }
    if (status.state === 'failed') return { success: false, text: `The export failed: ${status.error ?? 'unknown error'}` }
    if (status.state !== 'done') return { success: false, text: 'The export is still rendering; check the studio.' }
    return {
      success: true,
      text: `Exported: ${status.videoUrl} (1080x1920 MP4). The user can watch and download it in the studio: /ranking?id=${id}`,
    }
  }
}
