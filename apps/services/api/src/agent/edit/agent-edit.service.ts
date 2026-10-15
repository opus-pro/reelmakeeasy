import fs from 'node:fs'

import { Logger } from '@reelmakeeasy/common/logger'
import { BGM_DEFAULT_VOLUME } from '@reelmakeeasy/common/long-take/bgm-volume'
import {
  findMusicTrack,
  type MusicCatalog,
  musicRequestFromText,
  type MusicTrackRef,
} from '@reelmakeeasy/common/long-take/music-craft'
import { sanitizeGenerationResolution } from '@reelmakeeasy/common/model-config/story-mode-generation-resolution-config.zod'
import type { UserInfo } from '@reelmakeeasy/common/types/user'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { videoModelCapabilities } from '@reelmakeeasy/common/video-models/registry'

import type { BeatLoopClipChanges } from '../../long-take/beat-loop.service'
import type { LongTakeService } from '../../long-take/long-take.service'
import { buildLongTakeRequestUser } from '../../long-take/long-take-helpers.util'
import type { KeyframeSwapPlan } from '../../long-take/long-take-keyframe-swap.util'
import type { MusicService } from '../../music/music.service'
import type { ProjectService } from '../../projects/projects.service'
import { codexGeneratedImagesDir, projectFilePath } from '../agent-files'
import type { AgentSessionService } from '../agent-session.service'
import { type AutonomousService, loopBriefEvent } from '../autonomous/autonomous.service'
import type { ToolCallResult } from '../tools/agent-tools'
import { generateAgentImage } from '../tools/generate-image'
import {
  cancelWorkflow as defaultCancel,
  failureReason,
  waitForWorkflow as defaultWait,
} from '../workflow-outcome'

import { fitKeyframePicture, resolveKeyframePicture } from './keyframe-picture'
import {
  keyframeCardQuestion,
  keyframeDoneNote,
  keyframeFailure,
  type KeyframeSwapStage,
  keyframeToolAnswer,
  USE_PICTURE_ANSWER,
  USE_PICTURE_LABEL,
} from './keyframe-swap-text'
import { projectFolder } from './project-folder'

/** The session cannot enter edit mode yet; the message says why (409). */
export interface EditDeps {
  /** `make_video`: the Easy video start, driven by the style picker; `make_beat_loop`: a loop
   *  short's start, driven by its "Make this loop?" card or the style picker. */
  autonomous: Pick<AutonomousService, 'makeBeatLoop' | 'requestStyle'>
  /** Cancels a workflow a tool was waiting on (the user pressed Stop). */
  cancelWorkflow?: (workflowId: string) => Promise<void>
  /** `generate_image` (default: Nano Banana Lite through `generateAgentImage`). */
  generateImage?: typeof generateAgentImage
  longTake: Pick<
    LongTakeService,
    | 'commitKeyframe'
    | 'createBgmVersion'
    | 'getStateWithUnrenderedChanges'
    | 'getStatus'
    | 'isBeatLoopProject'
    | 'planKeyframeSwap'
    | 'regenerateLoopClip'
    | 'regenerateTransitionFromState'
    | 'remakeClipsWithKeyframe'
    | 'renderFromState'
    | 'swapLoopKeyframe'
    | 'updateBgmSettings'
  >
  /** The music library and the user's tracks, for a track named by title (absent: none). */
  music?: Pick<MusicService, 'catalog'>
  /** Where a picture for `use_image_as_keyframe` (or `generate_image`'s reference) may come
   *  from (default: Codex's saved images, the chat's folder and the video's project folder). */
  pictureRoots?: (sessionId: string, projectId?: string) => string[]
  projects: Pick<ProjectService, 'getProject'>
  sessions: Pick<
    AgentSessionService,
    | 'askServerQuestion'
    | 'beginEditing'
    | 'clearFlowCancelled'
    | 'emitAutonomousEvent'
    | 'emitNotice'
    | 'expireServerQuestion'
    | 'getSession'
    | 'isFlowCancelled'
    | 'linkProject'
    | 'notifyAgent'
    | 'sessionDir'
    | 'setFlowWorking'
    | 'workingDir'
  >
  /** Who the edits are made for (default: the request's user). */
  user?: () => UserInfo
  /** Resolves when the workflow ends (rejects when it fails or times out). */
  waitForWorkflow?: (workflowId: string, timeoutMs: number) => Promise<unknown>
}

export class EditNotReadyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EditNotReadyError'
  }
}

const WAIT_MS = 10 * 60 * 1000
const POLL_MS = 500
const NO_VIDEO = 'No finished video yet.'
const CLIP_BUSY = 'A clip is already being redone; wait for it.'
const RENDER_BUSY = 'The video is already being rebuilt; wait for it.'
const MUSIC_BUSY = 'The music is already being changed; wait for it.'
/** A loop short's run makes its clips one after another, then renders: each clip it makes
 *  (with a possible re-roll) gets this much longer than the base wait. */
const LOOP_WAIT_PER_CLIP_MS = 5 * 60 * 1000
const LOOP_PROMPT =
  "This video is a loop short: its clips are made from their storyboard slots. Leave out prompt, and pass changes to rewrite the clip's slots."
const LOOP_REBUILT = 'The video was rebuilt; no render_video needed.'
/** The clip slots a loop redo may rewrite: every key of `BeatLoopClipChanges`, so the type
 *  check keeps the list in step with the loop service. The storyboard check judges their values. */
const LOOP_SLOTS = Object.keys({
  caption: true,
  cut: true,
  cut_camera: true,
  freeze: true,
  hit: true,
  hit_camera: true,
  narration: true,
  stamp: true,
} satisfies Record<keyof BeatLoopClipChanges, true>)
const NOT_SLOTS = 'changes must be a JSON object of the clip\'s new slots, e.g. {"hit": "..."}.'
const KEYFRAME_BUSY = 'A keyframe is being changed; wait for it.'
/** A story clip made again: each one gets this much longer than the base wait. */
const STORY_WAIT_PER_CLIP_MS = 5 * 60 * 1000
const NO_KEYFRAME =
  'keyframe is required: its shotId in project/long_take/keyframes.json (e.g. 2, or f1 on a loop short).'
const NO_PICTURE =
  'image is required: the path of the picture (the one your image tool saved it to, or one in your working folder or in project/).'

/** A "Put the new picture in the video?" card waiting for its answer, by session. */
interface KeyframeCard {
  plan: KeyframeSwapPlan
  /** The picture, fitted to the keyframe: nothing is stored until the user says to. */
  png: Buffer
  projectId: string
  questionId: string
}

type Run = {
  kind: 'music' | 'regen' | 'render'
  /** What the workflow returned, once it finished. */
  result?: unknown
  /** How long to wait (default 10 minutes). */
  timeoutMs?: number
  workflowId: string
}
const BUSY_TEXT: Record<Run['kind'], string> = {
  music: MUSIC_BUSY,
  regen: CLIP_BUSY,
  render: RENDER_BUSY,
}

/**
 * Edit mode for a chat's finished video: opening the chat for editing, and the tools Codex
 * calls to change it (`regenerate_clip`, `render_video`, `set_music`), plus the two video
 * starts (`make_video`, `make_beat_loop`). A loop short's clips are redone through its own
 * run, which rebuilds the video; `set_music` mixes music beside its clip sound. Every tool
 * outcome is an answer, never a throw: Codex reads the text and tells the user.
 */
export class AgentEditService {
  private keyframeCardCount = 0
  /** Open "Put the new picture in the video?" cards, by session: one per chat. */
  private readonly keyframeCards = new Map<string, KeyframeCard>()
  /** Keyframe changes in flight (from the card's answer to the rebuilt video), by project. */
  private readonly keyframeJobs = new Set<string>()
  private readonly logger = new Logger(AgentEditService.name)
  /** Workflows a tool is waiting on, by project, so two calls never race on one video. */
  private readonly running = new Map<string, Run>()

  constructor(private readonly deps: EditDeps) {}

  /** A ReelMakeEasy tool the chat's agent called. */
  async callTool(sessionId: string, tool: string, args: unknown): Promise<ToolCallResult> {
    if (tool === 'generate_image') {
      const sessionDir = this.deps.sessions.sessionDir(sessionId)
      const { projectId } = this.deps.sessions.getSession(sessionId)
      // Once there is a video, a keyframe (or a frame pulled from a clip) can be the picture
      // to change: its pictures are allowed as the reference too.
      return (this.deps.generateImage ?? generateAgentImage)(
        args,
        projectId
          ? {
              referenceRoots: this.pictureRoots(sessionId, projectId),
              sessionDir,
              workingDir: this.deps.sessions.workingDir(sessionId),
            }
          : { sessionDir },
      )
    }
    try {
      // A Stop before this call was for whatever ran then, not for this.
      this.deps.sessions.clearFlowCancelled(sessionId)
      if (tool === 'regenerate_clip') return await this.regenerateClip(sessionId, args)
      if (tool === 'render_video') return await this.renderVideo(sessionId)
      if (tool === 'set_music') return await this.setMusic(sessionId, args)
      if (tool === 'use_image_as_keyframe') return await this.useImageAsKeyframe(sessionId, args)
      if (tool === 'make_video') return await this.makeVideo(sessionId, args)
      if (tool === 'make_beat_loop') return await this.makeBeatLoop(sessionId, args)
      return { success: false, text: `Unknown tool ${tool}.` }
    } catch (error) {
      return { success: false, text: ensureError(error).message }
    }
  }

  /** `POST /sessions/:id/edit`: the finished video's chat opens for editing. */
  async startEditing(sessionId: string): Promise<void> {
    const session = this.deps.sessions.getSession(sessionId)
    if (session.flowActive) throw new EditNotReadyError('The video is still being set up.')
    if (!session.projectId) throw new EditNotReadyError('This chat has no video to edit yet.')
    const status = await this.deps.longTake.getStatus(session.projectId)
    if (status?.stage !== 'completed' || !status.videoUrl)
      throw new EditNotReadyError('The video is not finished yet.')
    this.deps.sessions.beginEditing(sessionId, projectFolder(session.projectId))
  }

  /**
   * Shows the "Put the new picture in the video?" card and answers it detached: "Make it" starts
   * the change (`runKeyframeSwap`), anything else changes nothing. A newer card replaces an open
   * one (the old one expires); a card that expires (Stop, a shutdown) changes nothing.
   */
  private askToUseKeyframe(
    sessionId: string,
    card: Omit<KeyframeCard, 'questionId'>,
    user: UserInfo,
  ): void {
    const questionId = `keyframe-${Date.now().toString(36)}-${++this.keyframeCardCount}`
    const previous = this.keyframeCards.get(sessionId)
    this.keyframeCards.set(sessionId, { ...card, questionId })
    if (previous) this.deps.sessions.expireServerQuestion(sessionId, previous.questionId)
    void this.deps.sessions
      .askServerQuestion(sessionId, questionId, [keyframeCardQuestion(card.plan)])
      .then(
        (answers) => {
          if (this.keyframeCards.get(sessionId)?.questionId !== questionId) return
          this.keyframeCards.delete(sessionId)
          if ((answers[USE_PICTURE_ANSWER] ?? [])[0]?.trim() !== USE_PICTURE_LABEL) {
            this.deps.sessions.emitNotice(sessionId, 'The keyframe was not changed.')
            return
          }
          return this.runKeyframeSwap(sessionId, { ...card, questionId }, user)
        },
        () => {
          // Replaced, stopped or shut down: the card is gone, and nothing was made.
          if (this.keyframeCards.get(sessionId)?.questionId === questionId)
            this.keyframeCards.delete(sessionId)
        },
      )
      .catch((error: unknown) =>
        this.logger.error(`Keyframe change for ${sessionId} failed: ${ensureError(error).message}`),
      )
  }

  /** Waits for the workflow while watching for Stop: 'done', 'Stopped.', or the failure text. */
  private async await(sessionId: string, projectId: string, run: Run): Promise<string> {
    this.running.set(projectId, run)
    try {
      let settled: null | { error?: Error; ok?: true } = null
      ;(this.deps.waitForWorkflow ?? defaultWait)(run.workflowId, run.timeoutMs ?? WAIT_MS).then(
        (result) => {
          run.result = result
          settled = { ok: true }
        },
        (error: unknown) => (settled = { error: ensureError(error) }),
      )
      while (!settled) {
        if (this.deps.sessions.isFlowCancelled(sessionId)) {
          await (this.deps.cancelWorkflow ?? defaultCancel)(run.workflowId).catch(() => undefined)
          return 'Stopped.'
        }
        await new Promise((r) => setTimeout(r, POLL_MS))
      }
      const outcome: { error?: Error; ok?: true } = settled
      if (outcome.ok) return 'done'
      // Our wait gave up, not the workflow: stop it, or it finishes behind the user's back.
      if (/timed out/i.test(outcome.error?.message ?? ''))
        await (this.deps.cancelWorkflow ?? defaultCancel)(run.workflowId).catch(() => undefined)
      return `Failed: ${failureReason(outcome.error)}`
    } finally {
      this.running.delete(projectId)
    }
  }

  private busyText(projectId: string): null | string {
    const busy = this.running.get(projectId)
    if (busy) return BUSY_TEXT[busy.kind]
    return this.keyframeJobs.has(projectId) ? KEYFRAME_BUSY : null
  }

  /** The clips' files as the agent sees them (`project/long_take/transitions/...`), in order:
   *  a clip made again is written under a name of its own. Those it can't name are left out. */
  private async clipFiles(projectId: string, transitionIds: string[]): Promise<string[]> {
    try {
      const { data } = await this.deps.longTake.getStateWithUnrenderedChanges(projectId)
      return transitionIds.flatMap((id) => {
        const file = projectFilePath(data.transitions.find((t) => t.transitionId === id)?.videoUri)
        return file ? [file] : []
      })
    } catch (error) {
      this.logger.warn(`Reading the clips of ${projectId} failed: ${ensureError(error).message}`)
      return []
    }
  }

  /** The session's project id when its video is finished and delivered, else null. */
  private async finishedProject(sessionId: string): Promise<null | string> {
    const { projectId } = this.deps.sessions.getSession(sessionId)
    if (!projectId) return null
    const status = await this.deps.longTake.getStatus(projectId)
    return status?.stage === 'completed' && status.videoUrl ? projectId : null
  }

  /** The session's project id when it is a loop short (finished or not), else null. */
  private async loopProject(sessionId: string): Promise<null | string> {
    const { projectId } = this.deps.sessions.getSession(sessionId)
    if (!projectId) return null
    return (await this.deps.longTake.isBeatLoopProject(projectId)) ? projectId : null
  }

  /** `make_beat_loop` (Free chat): the storyboard is checked, every issue at once, and every
   *  line is said in the loop's voice (a line too long for its clip is an issue too); when it
   *  all passes, the "Make this loop?" card (or the style picker, for a storyboard without a
   *  style) appears and its answer starts the loop. Answers with the length, estimate and
   *  voice. */
  private async makeBeatLoop(sessionId: string, args: unknown): Promise<ToolCallResult> {
    if (this.deps.sessions.getSession(sessionId).projectId)
      return {
        success: false,
        text: 'This chat already made a video; use regenerate_clip to change it.',
      }
    const a = (args ?? {}) as { storyboard?: unknown; title?: unknown; voice?: unknown }
    // A JSON string from the tool bridge; an object is checked the same way.
    const storyboard =
      typeof a.storyboard === 'string' ? trimmed(a.storyboard) : (a.storyboard ?? undefined)
    if (storyboard === undefined)
      return {
        success: false,
        text: 'storyboard is required: the whole storyboard as one JSON string.',
      }
    const title = trimmed(a.title)
    const voice = trimmed(a.voice)
    const result = await this.deps.autonomous.makeBeatLoop(sessionId, {
      storyboard,
      ...(title ? { title } : {}),
      ...(voice ? { voice } : {}),
    })
    return { success: result.status !== 'invalid', text: JSON.stringify(result) }
  }

  /** `make_video` (Free chat): the approved script becomes the brief, and the style picker
   *  card appears; the pick starts the video through the Easy start path. */
  private async makeVideo(sessionId: string, args: unknown): Promise<ToolCallResult> {
    const session = this.deps.sessions.getSession(sessionId)
    if (session.projectId)
      return {
        success: false,
        text: 'This chat already made a video; use regenerate_clip and render_video to change it.',
      }
    const a = (args ?? {}) as {
      cameraStyle?: unknown
      music?: unknown
      script?: unknown
      title?: unknown
    }
    const script = typeof a.script === 'string' ? a.script.trim() : ''
    const title = typeof a.title === 'string' ? a.title.trim() : ''
    const words = script.split(/\s+/).filter(Boolean).length
    if (words < 25 || words > 250)
      return {
        success: false,
        text: 'The script must be 25 to 250 words (15-90 seconds of narration).',
      }
    const replaced = this.deps.autonomous.requestStyle(sessionId, {
      brief: title || script.slice(0, 80),
      ...(a.cameraStyle === 'dynamic' || a.cameraStyle === 'calm'
        ? { cameraStyle: a.cameraStyle }
        : {}),
      // About 2.5 spoken words per second.
      durationSeconds: Math.round(words / 2.5),
      music: musicRequestFromText(
        typeof a.music === 'string' ? a.music : undefined,
        await this.musicCatalog(),
      ),
      script,
      title: title || 'Untitled video',
    })
    return {
      success: true,
      text: JSON.stringify(
        replaced
          ? {
              status: 'waiting_for_style',
              note: 'The script was updated; the style card is still open.',
            }
          : { status: 'waiting_for_style' },
      ),
    }
  }

  /** The library and the user's tracks, for a track named by title; none without a service. */
  private async musicCatalog(): Promise<MusicCatalog> {
    if (!this.deps.music) return { library: [], mine: [] }
    try {
      return await this.deps.music.catalog((this.deps.user ?? buildLongTakeRequestUser)().userId)
    } catch {
      return { library: [], mine: [] }
    }
  }

  private musicState(project: MusicProjectFields): string {
    return JSON.stringify({
      bgmEnabled: project?.bgmEnabled ?? false,
      prompt: project?.bgmPrompt ?? null,
      trackName: project?.bgmTrackName ?? null,
      // The music volume as a percentage of the narration (100 = as loud as the narration).
      volume: project?.bgmVolume ?? BGM_DEFAULT_VOLUME,
    })
  }

  /**
   * The workflows a music change runs, in order: a new bed (a track to fit, a prompt to
   * compose from, or none yet on the project) and then its level; or one remux of the
   * delivered file for on/off and the level together.
   */
  private musicSteps(input: {
    enabled: boolean
    project: MusicProjectFields
    projectId: string
    prompt?: string
    track?: MusicTrackRef
    user: UserInfo
    volume?: number
  }): (() => Promise<ToolCallResult | { workflowId: string }>)[] {
    const { enabled, project, projectId, prompt, track, user, volume } = input
    if (enabled && (track || prompt || !project?.bgmBedUri)) {
      const body = track ? { track } : prompt ? { prompt } : {}
      return [
        () => this.deps.longTake.createBgmVersion(projectId, body, user),
        ...(volume === undefined
          ? []
          : [() => this.startSettingsChange(projectId, project, { bgmVolume: volume }, user)]),
      ]
    }
    const settings =
      enabled && volume !== undefined && project?.bgmEnabled === true
        ? { bgmVolume: volume }
        : { bgmEnabled: enabled, ...(volume === undefined ? {} : { bgmVolume: volume }) }
    return [() => this.startSettingsChange(projectId, project, settings, user)]
  }

  /** Where a picture the agent names may come from: Codex's saved images, the chat's own folder
   *  (frames it pulled, generate_image's pictures) and the video's project folder (its keyframes
   *  and the pictures the user gave with the brief). */
  private pictureRoots(sessionId: string, projectId: string): string[] {
    return (
      this.deps.pictureRoots?.(sessionId, projectId) ?? [
        codexGeneratedImagesDir(),
        this.deps.sessions.sessionDir(sessionId),
        projectFolder(projectId),
      ]
    )
  }

  private async regenerateClip(sessionId: string, args: unknown): Promise<ToolCallResult> {
    const loopId = await this.loopProject(sessionId)
    if (loopId) return this.regenerateLoopClip(sessionId, loopId, args)
    const projectId = await this.finishedProject(sessionId)
    if (!projectId) return { success: false, text: NO_VIDEO }
    const a = (args ?? {}) as { prompt?: unknown; transitionId?: unknown }
    const transitionId = typeof a.transitionId === 'string' ? a.transitionId.trim() : ''
    const prompt = typeof a.prompt === 'string' ? a.prompt.trim() : ''
    if (!prompt) return { success: false, text: 'prompt is required.' }
    const { data } = await this.deps.longTake.getStateWithUnrenderedChanges(projectId)
    const clip = data.transitions.find((t) => t.transitionId === transitionId)
    if (!clip) {
      const list = data.transitions
        .map(
          (t) =>
            `${t.transitionId} (${(t.startMs / 1000).toFixed(1)}-${(t.endMs / 1000).toFixed(1)} s)`,
        )
        .join(', ')
      return { success: false, text: `No clip ${transitionId || '(none)'}. Clips: ${list}.` }
    }
    const busy = this.busyText(projectId)
    if (busy) return { success: false, text: busy }
    const user = (this.deps.user ?? buildLongTakeRequestUser)()
    const { workflowId } = await this.starting(projectId, 'regen', () =>
      this.deps.longTake.regenerateTransitionFromState(projectId, transitionId, prompt, user, {
        promptIsFinal: true,
      }),
    )
    const outcome = await this.await(sessionId, projectId, { kind: 'regen', workflowId })
    if (outcome !== 'done') return { success: false, text: outcome }
    const project = await this.deps.projects.getProject(projectId)
    // The new clip has a file of its own: the old one is still there under the clip's id.
    const [videoPath] = await this.clipFiles(projectId, [transitionId])
    const durationSeconds = Number(((clip.endMs - clip.startMs) / 1000).toFixed(3))
    const resolution =
      sanitizeGenerationResolution(project?.generationResolution)?.videoResolution ?? '768p'
    const usdPerSecond = videoModelCapabilities(undefined).usdPerSecond?.[resolution] ?? 0.04
    // Hailuo makes whole seconds from 5 to 15; the retime fits the clip to its slot.
    const generatedSeconds = Math.min(15, Math.max(5, Math.ceil(durationSeconds)))
    return {
      success: true,
      text: JSON.stringify({
        cameraStyle: project?.cameraStyle ?? 'calm',
        durationSeconds,
        endMs: clip.endMs,
        estimatedCostUsd: Number((usdPerSecond * generatedSeconds).toFixed(2)),
        startMs: clip.startMs,
        transitionId,
        ...(videoPath ? { videoPath } : {}),
      }),
    }
  }

  /**
   * `regenerate_clip` on a loop short: the clip is made again from its storyboard slots
   * (rewritten by `changes`), starting from the real last frame of the clip before it, and the
   * loop's own run rebuilds the video. The clips after it stay as they are unless
   * `redoFollowing`; the reply quotes what making them again would cost. It also runs on a
   * loop whose last run failed: the loop service refuses what it can't redo (a clip before it
   * never made, a run still going) before anything is set aside.
   */
  private async regenerateLoopClip(
    sessionId: string,
    projectId: string,
    args: unknown,
  ): Promise<ToolCallResult> {
    const a = (args ?? {}) as {
      changes?: unknown
      prompt?: unknown
      redoFollowing?: unknown
      transitionId?: unknown
    }
    if (trimmed(a.prompt)) return { success: false, text: LOOP_PROMPT }
    if (a.redoFollowing != null && typeof a.redoFollowing !== 'boolean')
      return { success: false, text: 'redoFollowing must be true or false.' }
    const parsed = parseLoopChanges(a.changes)
    if ('error' in parsed) return { success: false, text: parsed.error }
    const busy = this.busyText(projectId)
    if (busy) return { success: false, text: busy }
    const clipId = trimmed(a.transitionId) ?? ''
    const user = (this.deps.user ?? buildLongTakeRequestUser)()
    const started = await this.starting(projectId, 'regen', () =>
      this.deps.longTake.regenerateLoopClip(
        projectId,
        clipId,
        {
          ...(parsed.changes ? { changes: parsed.changes } : {}),
          redoFollowing: a.redoFollowing === true,
        },
        user,
      ),
    )
    // The panel shows the lines and stamps as they now are, not as make_beat_loop left them.
    if (parsed.changes)
      this.deps.sessions.emitAutonomousEvent(sessionId, loopBriefEvent(started.storyboard))
    const run: Run = {
      kind: 'regen',
      timeoutMs: WAIT_MS + started.clipIds.length * LOOP_WAIT_PER_CLIP_MS,
      workflowId: started.workflowId,
    }
    const outcome = await this.await(sessionId, projectId, run)
    if (outcome !== 'done') return { success: false, text: outcome }
    // The loop's run rendered the video again: the page plays the new one.
    this.deps.sessions.emitAutonomousEvent(sessionId, { projectId, type: 'video_rendered' })
    const following = started.followingClipIds
    const keptAfter = following.filter((id) => !started.clipIds.includes(id))
    // Redoing the first kept clip with redoFollowing makes it and every clip after it again.
    const redoCount = keptAfter.length ? following.length - following.indexOf(keptAfter[0]) : 0
    const flaggedClips = flaggedClipsOf(run.result)
    const otherModelClips = otherModelClipsOf(run.result)
    // Only the clip's words changed: the clip was kept, and only the words were made again.
    const clipKept = started.clipRemade === false
    const note = [
      ...otherModelClips.map(
        (clip) =>
          `Clip ${clip.clipId} was made with ${clip.model}: ${clip.failedModel} failed on it, so it cost that model's price.`,
      ),
      clipKept
        ? wordsOnlyNote(clipId, started.clipIds, started.clipUsd)
        : loopRedoNote(clipId, keptAfter, redoCount, started.clipUsd),
    ].join(' ')
    return {
      success: true,
      text: JSON.stringify({
        clipId,
        ...(clipKept ? { clipKept } : {}),
        clipsMade: started.clipIds,
        clipUsd: started.clipUsd,
        estimatedCostUsd: started.estimatedCostUsd,
        ...(flaggedClips.length ? { flaggedClips } : {}),
        keptAfter,
        note,
        ...(otherModelClips.length ? { otherModelClips } : {}),
        redoFollowing: started.redoFollowing,
        videoPath: 'project/final_video.mp4',
      }),
    }
  }

  private async renderVideo(sessionId: string): Promise<ToolCallResult> {
    const projectId = await this.finishedProject(sessionId)
    if (!projectId) return { success: false, text: NO_VIDEO }
    const busy = this.busyText(projectId)
    if (busy) return { success: false, text: busy }
    const user = (this.deps.user ?? buildLongTakeRequestUser)()
    const { workflowId } = await this.starting(projectId, 'render', () =>
      this.deps.longTake.renderFromState(projectId, user),
    )
    const outcome = await this.await(sessionId, projectId, { kind: 'render', workflowId })
    if (outcome !== 'done') return { success: false, text: outcome }
    // The page re-reads the project: the chat's player and the storyboard show the new video.
    this.deps.sessions.emitAutonomousEvent(sessionId, { projectId, type: 'video_rendered' })
    return { success: true, text: JSON.stringify({ videoPath: 'project/final_video.mp4' }) }
  }

  /**
   * The change the card's "Make it" starts, outside any turn of the agent's: the chat shows it
   * working, and Stop stops it. However it ends, the chat says so when it didn't finish (a
   * notice), and the agent hears how it went in a turn of its own (`notifyAgent`) and tells the
   * user, except after a Stop that changed nothing.
   */
  private async runKeyframeSwap(
    sessionId: string,
    card: KeyframeCard,
    user: UserInfo,
  ): Promise<void> {
    const { plan, projectId } = card
    const busy = this.busyText(projectId)
    if (busy) {
      this.tell(sessionId, {
        note: `ReelMakeEasy note, not shown to the user: the user clicked "${USE_PICTURE_LABEL}" for the new picture as keyframe ${plan.shotId}, but another change was still running on the video, so nothing was made or spent. Tell the user in one plain sentence; once that change is done, call use_image_as_keyframe again (a new card asks first).`,
        notice: `Couldn't put the new picture in yet: ${busy}`,
      })
      return
    }
    this.keyframeJobs.add(projectId)
    // The answer is a new go-ahead: a Stop from before it was for something else.
    this.deps.sessions.clearFlowCancelled(sessionId)
    this.deps.sessions.setFlowWorking(sessionId, true)
    let told: { note?: string; notice?: string }
    try {
      told = plan.loop
        ? await this.swapLoopKeyframe(sessionId, card, user)
        : await this.swapStoryKeyframe(sessionId, card, user)
    } finally {
      this.keyframeJobs.delete(projectId)
      this.deps.sessions.setFlowWorking(sessionId, false)
    }
    this.tell(sessionId, told)
  }

  /** `set_music`: off removes the bed (a remux), on puts it back or makes one, a track by
   *  title is fitted, a prompt makes a new bed from it word for word, and a volume sets
   *  how loud the music sits under the narration. The delivered file is rewritten in place:
   *  a new bed first, then its level, one workflow at a time. */
  private async setMusic(sessionId: string, args: unknown): Promise<ToolCallResult> {
    // A loop takes music like any video: it goes under the loop's own sound (its finish pass).
    const projectId = await this.finishedProject(sessionId)
    if (!projectId) return { success: false, text: NO_VIDEO }
    const busy = this.busyText(projectId)
    if (busy) return { success: false, text: busy }
    const parsed = parseSetMusicArgs(args)
    if ('error' in parsed) return { success: false, text: parsed.error }
    const { enabled, prompt, trackText, volumeChange } = parsed
    const user = (this.deps.user ?? buildLongTakeRequestUser)()
    const project = await this.deps.projects.getProject(projectId)
    // A relative change ("quieter") moves from where the level is now.
    const volume =
      parsed.volume ??
      (volumeChange === undefined
        ? undefined
        : Math.max(0, Math.min(100, (project?.bgmVolume ?? BGM_DEFAULT_VOLUME) + volumeChange)))
    // A track by title: a library track or one of the user's own; nothing is guessed.
    let track: MusicTrackRef | undefined
    if (enabled && trackText) {
      const catalog = await this.musicCatalog()
      const found = findMusicTrack(trackText, catalog)
      if (!found) return { success: false, text: noSuchTrack(trackText, catalog) }
      track = found
    }
    const steps = this.musicSteps({ enabled, project, projectId, prompt, track, user, volume })
    let done = 0
    for (const step of steps) {
      const started = await this.starting(projectId, 'music', step)
      if ('text' in started && done === 0) return started
      const outcome =
        'text' in started
          ? started.text
          : await this.await(sessionId, projectId, {
              kind: 'music',
              workflowId: started.workflowId,
            })
      if (outcome === 'done') {
        done += 1
        continue
      }
      if (done === 0) return { success: false, text: outcome }
      // The new bed is already in the file; only its level did not change. Say so, and
      // let the page play the new file.
      this.deps.sessions.emitAutonomousEvent(sessionId, { projectId, type: 'video_rendered' })
      return {
        success: false,
        text: `${outcome} The new music is on, but its volume was not changed.`,
      }
    }
    // The delivered file changed in place: the page reloads it.
    this.deps.sessions.emitAutonomousEvent(sessionId, { projectId, type: 'video_rendered' })
    return { success: true, text: this.musicState(await this.deps.projects.getProject(projectId)) }
  }

  /** Starts a workflow with the project already marked busy, so a call made while it starts is
   *  refused; `await` takes the mark over. A start that throws, or answers without a
   *  workflow, frees the project. */
  private async starting<T extends object>(
    projectId: string,
    kind: Run['kind'],
    start: () => Promise<T>,
  ): Promise<T> {
    this.running.set(projectId, { kind, workflowId: '' })
    try {
      const started = await start()
      if (!('workflowId' in started)) this.running.delete(projectId)
      return started
    } catch (error) {
      this.running.delete(projectId)
      throw error
    }
  }

  /**
   * Starts a remux of the delivered file at new settings. Answers the tool directly when
   * there is nothing to rewrite; music on for a project without a bed makes one.
   */
  private async startSettingsChange(
    projectId: string,
    project: MusicProjectFields,
    settings: { bgmEnabled?: boolean; bgmVolume?: number },
    user: UserInfo,
  ): Promise<ToolCallResult | { workflowId: string }> {
    const remux = await this.deps.longTake.updateBgmSettings(projectId, settings, user)
    if (remux.remux === 'skipped_not_delivered') return { success: false, text: NO_VIDEO }
    if (remux.remux === 'started' && remux.workflowId) return { workflowId: remux.workflowId }
    // Nothing to rewrite: off with no bed is already the case.
    if (settings.bgmEnabled === false) return { success: true, text: this.musicState(project) }
    return this.deps.longTake.createBgmVersion(projectId, {}, user)
  }

  /** A loop short: its own run makes the clips from the one landing on the frame on, and the
   *  loop. What to tell the chat and the agent. */
  private async swapLoopKeyframe(
    sessionId: string,
    card: KeyframeCard,
    user: UserInfo,
  ): Promise<{ note?: string; notice?: string }> {
    const { plan, png, projectId } = card
    let started: { clipIds: string[]; workflowId: string }
    try {
      started = await this.starting(projectId, 'regen', () =>
        this.deps.longTake.swapLoopKeyframe(projectId, plan.shotId, png, user),
      )
    } catch (error) {
      return keyframeFailure(plan, 'clips', `Failed: ${ensureError(error).message}`)
    }
    const run: Run = {
      kind: 'regen',
      timeoutMs: WAIT_MS + started.clipIds.length * LOOP_WAIT_PER_CLIP_MS,
      workflowId: started.workflowId,
    }
    const outcome = await this.await(sessionId, projectId, run)
    if (outcome !== 'done') return keyframeFailure(plan, 'loop', outcome)
    this.deps.sessions.emitAutonomousEvent(sessionId, { projectId, type: 'video_rendered' })
    const flagged = flaggedClipsOf(run.result).map(
      (clip) => `Clip ${clip.clipId} still fails a check: ${clip.failures.join(' ')}`,
    )
    return { note: keyframeDoneNote(plan, flagged.join(' ')) }
  }

  /** A story video: the clips made again from the new picture, the picture made the keyframe,
   *  the video rendered again, each step once the one before is done. What to tell the chat and
   *  the agent. */
  private async swapStoryKeyframe(
    sessionId: string,
    card: KeyframeCard,
    user: UserInfo,
  ): Promise<{ note?: string; notice?: string }> {
    const { plan, png, projectId } = card
    let stage: KeyframeSwapStage = 'clips'
    try {
      const made = await this.starting(projectId, 'regen', () =>
        this.deps.longTake.remakeClipsWithKeyframe(projectId, plan.shotId, png, user),
      )
      const clips = await this.await(sessionId, projectId, {
        kind: 'regen',
        timeoutMs: WAIT_MS + plan.clips.length * STORY_WAIT_PER_CLIP_MS,
        workflowId: made.workflowId,
      })
      if (clips !== 'done') return keyframeFailure(plan, 'clips', clips)
      stage = 'picture'
      await this.deps.longTake.commitKeyframe(projectId, plan.shotId, {
        keyframeUri: made.keyframeUri,
        picturePath: made.picturePath,
        ...(made.thumbnailUri ? { thumbnailUri: made.thumbnailUri } : {}),
      })
      stage = 'render'
      const { workflowId } = await this.starting(projectId, 'render', () =>
        this.deps.longTake.renderFromState(projectId, user),
      )
      const rendered = await this.await(sessionId, projectId, { kind: 'render', workflowId })
      if (rendered !== 'done') return keyframeFailure(plan, 'render', rendered)
    } catch (error) {
      return keyframeFailure(plan, stage, `Failed: ${ensureError(error).message}`)
    }
    // The page re-reads the project: the chat's player and the storyboard show the new video.
    this.deps.sessions.emitAutonomousEvent(sessionId, { projectId, type: 'video_rendered' })
    const clipFiles = await this.clipFiles(
      projectId,
      plan.clips.map((clip) => clip.id),
    )
    return { note: keyframeDoneNote(plan, '', clipFiles) }
  }

  /** The chat's notice and the agent's note; a chat that went away meanwhile hears nothing. */
  private tell(sessionId: string, told: { note?: string; notice?: string }): void {
    try {
      if (told.notice) this.deps.sessions.emitNotice(sessionId, told.notice)
      if (told.note) this.deps.sessions.notifyAgent(sessionId, told.note)
    } catch (error) {
      this.logger.warn(
        `Telling chat ${sessionId} how its keyframe went failed: ${ensureError(error).message}`,
      )
    }
  }

  /**
   * `use_image_as_keyframe`: a picture the agent made, edited or pulled (or one in the project)
   * as keyframe N. The picture is checked and fitted to the keyframe's size, and the clips it
   * makes again are priced; then a card asks the user, and nothing is stored or paid for until
   * they click "Make it" there. Answers at once with the clips and the cost.
   */
  private async useImageAsKeyframe(sessionId: string, args: unknown): Promise<ToolCallResult> {
    const { projectId } = this.deps.sessions.getSession(sessionId)
    if (!projectId) return { success: false, text: NO_VIDEO }
    // A story video must be finished; a loop short whose last run stopped can take one too (its
    // service refuses a frame or clips not made yet).
    const loop = await this.deps.longTake.isBeatLoopProject(projectId)
    if (!loop && !(await this.finishedProject(sessionId))) return { success: false, text: NO_VIDEO }
    const busy = this.busyText(projectId)
    if (busy) return { success: false, text: busy }
    const a = (args ?? {}) as { image?: unknown; keyframe?: unknown }
    const keyframe = typeof a.keyframe === 'number' ? String(a.keyframe) : trimmed(a.keyframe)
    if (!keyframe) return { success: false, text: NO_KEYFRAME }
    const image = trimmed(a.image)
    if (!image) return { success: false, text: NO_PICTURE }
    const picture = resolveKeyframePicture(image, {
      roots: this.pictureRoots(sessionId, projectId),
      workingDir: this.deps.sessions.workingDir(sessionId),
    })
    if (!picture) {
      return {
        success: false,
        text: `Can't use ${image}: give a picture you made or edited in this chat (the path your image tool saved it to), a frame in your working folder, or a picture in project/, by its own path (nothing can be copied into project/).`,
      }
    }
    const plan = await this.deps.longTake.planKeyframeSwap(projectId, keyframe)
    const fitted = await fitKeyframePicture(await fs.promises.readFile(picture), plan.frame)
    if ('error' in fitted) return { success: false, text: fitted.error }
    // Read in the call (its context names the user), before the card's answer is detached.
    const user = (this.deps.user ?? buildLongTakeRequestUser)()
    this.askToUseKeyframe(sessionId, { plan, png: fitted.png, projectId }, user)
    return { success: true, text: keyframeToolAnswer(plan, fitted) }
  }
}

/** The project fields a music answer reads. */
type MusicProjectFields =
  | null
  | undefined
  | {
      bgmBedUri?: null | string
      bgmEnabled?: boolean | null
      bgmPrompt?: null | string
      bgmTrackName?: null | string
      bgmVolume?: null | number
    }

/** `set_music`'s arguments: on unless told off, trimmed text for the prompt and track, and
 *  a whole-number level from 0 to 100. */
function parseSetMusicArgs(args: unknown):
  | {
      enabled: boolean
      prompt?: string
      trackText?: string
      volume?: number
      volumeChange?: number
    }
  | { error: string } {
  const a = (args ?? {}) as {
    enabled?: unknown
    prompt?: unknown
    track?: unknown
    volume?: unknown
    volume_change?: unknown
  }
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  const whole = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
  if (a.volume !== undefined && a.volume !== null && !whole(a.volume, 0, 100)) {
    return { error: 'volume must be a whole number from 0 to 100.' }
  }
  if (
    a.volume_change !== undefined &&
    a.volume_change !== null &&
    !whole(a.volume_change, -100, 100)
  ) {
    return { error: 'volume_change must be a whole number from -100 to 100.' }
  }
  return {
    enabled: a.enabled !== false,
    prompt: text(a.prompt),
    trackText: text(a.track),
    ...(typeof a.volume === 'number' ? { volume: a.volume } : {}),
    ...(typeof a.volume_change === 'number' ? { volumeChange: a.volume_change } : {}),
  }
}

/** The clips a loop run kept although they still fail a check (its workflow's result). */
function flaggedClipsOf(result: unknown): { clipId: string; failures: string[] }[] {
  const flagged = (result as null | undefined | { flaggedClips?: unknown })?.flaggedClips
  if (!Array.isArray(flagged)) return []
  return flagged.flatMap((clip: { clipId?: unknown; failures?: unknown }) =>
    typeof clip?.clipId === 'string'
      ? [
          {
            clipId: clip.clipId,
            failures: Array.isArray(clip.failures) ? clip.failures.map(String) : [],
          },
        ]
      : [],
  )
}

/** The clips a loop run made on the other provider's model, its first model having failed on
 *  them (its workflow's result). */
function otherModelClipsOf(
  result: unknown,
): { clipId: string; failedModel: string; model: string }[] {
  const clips = (result as null | undefined | { otherModelClips?: unknown })?.otherModelClips
  if (!Array.isArray(clips)) return []
  return clips.flatMap((clip: { clipId?: unknown; failedModel?: unknown; model?: unknown }) =>
    typeof clip?.clipId === 'string' && typeof clip.model === 'string'
      ? [{ clipId: clip.clipId, failedModel: String(clip.failedModel ?? ''), model: clip.model }]
      : [],
  )
}

/**
 * The note of a loop redo whose changes only touched the clip's words: the clip was kept, and
 * how to make it again after all. `madeIds` are clips a stopped run never made: the run made
 * them anyway.
 */
function wordsOnlyNote(clipId: string, madeIds: string[], clipUsd: number): string {
  const usd = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`
  const words = "Only the clip's words changed (narration, caption or stamp)"
  const remade = 'the voice-over, captions and stamps were made again'
  if (!madeIds.length) {
    return `${words}, so clip ${clipId} was kept and no clip was paid for: ${remade}. To make the clip itself again (about ${usd(clipUsd)}), call regenerate_clip on ${clipId} without changes. ${LOOP_REBUILT}`
  }
  const one = madeIds.length === 1
  const made = `${one ? 'Clip' : 'Clips'} ${madeIds.join(', ')} had never been made, so the run made ${one ? 'it' : 'them'} (about ${usd(clipUsd * madeIds.length)})`
  return `${words}, so clip ${clipId} was kept: ${remade}. ${made}. To make clip ${clipId} itself again (about ${usd(clipUsd)}), call regenerate_clip on ${clipId} without changes. ${LOOP_REBUILT}`
}

/**
 * A loop redo's note: the clips after it that were kept, and how to make them again. That is a
 * redo of the first kept clip with redoFollowing (not of this clip again, which would throw its
 * new take away), and it makes `redoCount` clips: the kept ones and any made after them.
 */
function loopRedoNote(
  clipId: string,
  keptAfter: string[],
  redoCount: number,
  clipUsd: number,
): string {
  if (!keptAfter.length) return LOOP_REBUILT
  const usd = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`
  const one = keptAfter.length === 1
  const kept = one
    ? `Clip ${keptAfter[0]} after it was kept as it was`
    : `Clips ${keptAfter.join(', ')} after it were kept as they were`
  const extra = redoCount - keptAfter.length
  const extraClips = extra === 1 ? 'clip' : `${extra} clips`
  const withAfter = extra > 0 ? `, with the ${extraClips} after ${one ? 'it' : 'them'},` : ''
  const price =
    redoCount === 1 ? usd(clipUsd) : `${usd(clipUsd)} a clip (${usd(clipUsd * redoCount)})`
  return `${kept}, so the cut from ${clipId} into ${keptAfter[0]} may jump a little. Making ${one ? 'it' : 'them'} again too${withAfter} costs about ${price}: call regenerate_clip on ${keptAfter[0]} with redoFollowing true. ${LOOP_REBUILT}`
}

/** `regenerate_clip`'s `changes` on a loop: a JSON object (or one as a string) of the slots a
 *  redo may rewrite; nothing when absent or empty. */
function parseLoopChanges(value: unknown): { changes?: BeatLoopClipChanges } | { error: string } {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim()))
    return {}
  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      return { error: NOT_SLOTS }
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: NOT_SLOTS }
  const keys = Object.keys(parsed)
  const others = keys.filter((key) => !LOOP_SLOTS.includes(key))
  if (others.length)
    return {
      error: `changes can only rewrite ${LOOP_SLOTS.join(', ')} (not ${others.join(', ')}).`,
    }
  return keys.length ? { changes: parsed as BeatLoopClipChanges } : {}
}

/** Trimmed text, or undefined for anything else or nothing but spaces. */
function trimmed(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

/** The tool's answer when no track has that title: what it could have named instead. */
function noSuchTrack(text: string, catalog: MusicCatalog): string {
  const library = catalog.library.map((t) => t.title).join(', ') || 'none'
  const mine = catalog.mine.map((t) => t.name).join(', ') || 'none'
  return `No track called "${text}". Library: ${library}. Your tracks: ${mine}.`
}
