/**
 * Loop shorts (the beat-loop skill) on the API side: the start, Try again, and a redone clip.
 *
 * The start writes the storyboard to `long_take/beat_loop.json` (the render reads it to know the
 * project is a loop) and starts BeatLoopWorkflow through the same admission queue as a long-take
 * video. Every later run of the project (Try again, a redone clip) starts the same workflow
 * again: it reuses, in order, the clips its QA record (`long_take/beat_loop_qa.json`) kept and
 * makes the rest, so a clip made again starts from the real last frame (`_last.png`) of the clip
 * kept before it. Redoing a clip starts it over in that record first: its `generation` moves on
 * (its old takes stay on record, with what they cost, but can't be kept), as does every clip
 * after it the run makes again; the clips after it kept as they are get `keepAfterRedo`.
 *
 * Before a loop is offered at all, `checkLines` says every narration line in the loop's voice
 * and measures it (agent mode's `make_beat_loop`): the run reuses that audio, kept by voice and
 * words, so a line is checked and paid for once.
 *
 * The API may not import the story-mode runtime: the workflow's name and the two files' paths
 * and shapes are repeated here. Keep them in step with libs/story-mode-runtime/src/workflows/
 * beat-loop and activities/beat-loop/qa-store.ts.
 */
import {
  type BeatLoopLineCheck,
  checkBeatLoopLines,
} from '@agent-lib/agents/story-loader/voice-tools/utils/beat-loop-lines.util'
import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { KvStore } from '@reelmakeeasy/common/kv/store'
import { Logger } from '@reelmakeeasy/common/logger'
import {
  type BeatLoopCost,
  beatLoopCost,
  beatLoopModelOrder,
  validateBeatLoopStoryboard,
} from '@reelmakeeasy/common/long-take/beat-loop-craft'
import { isMissingObjectError } from '@reelmakeeasy/common/storage/missing'
import { defaultLoopVoiceId } from '@reelmakeeasy/common/tts/default-voice'
import type { UserInfo } from '@reelmakeeasy/common/types/user'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { createClient } from '@reelmakeeasy/common/workflow/client'
import { getWorkflowId } from '@reelmakeeasy/common/workflow/workflow-id'
import {
  type GenerationProvider,
  modelRegistry,
  type ModelRegistryFile,
} from '@reelmakeeasy/llm/registry'
import { WorkflowNotFoundError } from '@reelmakeeasy/workflow-engine/common'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common'
import {
  BEAT_LOOP_USE_CASE,
  type BeatLoopClip,
  type BeatLoopStoryboard,
} from '@shared/types/api/agent'
import type { DebugSettings } from '@shared/types/project/debug-settings'

import { MediaService } from '../media/media.service'
import { PrismaService } from '../prisma/prisma.service'
import { ProjectService } from '../projects/projects.service'
import { presetPreviewData } from '../voice-over/voice-over'

import { startStandaloneAdmissionWorkflow } from './admission-helpers'
import { resolveEffectiveBgm } from './long-take-bgm-settings.util'
import { readOptionalJsonFile } from './long-take-helpers.util'
import {
  type ResolvedRequestVoice,
  resolveLongTakeRequestVoice,
} from './long-take-voice-guard.util'
import {
  buildQueuedAdmissionMeta,
  persistDebugOverrides,
  resolveStoryModeTaskQueue,
} from './long-take-workflow.util'

/** The loop's record of its keyframes (the story-mode runtime's `BEAT_LOOP_KEYFRAMES_PATH`):
 *  a run reuses the frames on it for as long as their prompts match. */
const BEAT_LOOP_KEYFRAMES_PATH = 'long_take/beat_loop_keyframes.json'
const LOOP_KEYFRAMES_DIR = 'long_take/keyframes'
const LOOP_KEYFRAMES_JSON_PATH = 'long_take/keyframes.json'

/** `beat_loop_keyframes.json`: each frame's picture (`uri`); fN copies f0 (`copyOf`). */
interface LoopFrameRecord {
  [key: string]: unknown
  frames: { [key: string]: unknown; copyOf?: string; id: string; uri: string }[]
}

/** The workflow a loop runs (exported by name from the story-mode worker). */
export const BEAT_LOOP_WORKFLOW_NAME = 'BeatLoopWorkflow'
/** The loop's storyboard and how it is made; its presence makes the render finish a loop. */
export const BEAT_LOOP_PATH = 'long_take/beat_loop.json'
/** Every take of every clip and the take each clip kept (the beat-loop activities write it). */
export const BEAT_LOOP_QA_PATH = 'long_take/beat_loop_qa.json'

const LOOP_BUSY = 'This loop is still being made; wait for it to finish.'
const NOT_A_LOOP = 'This project is not a loop short.'
const NO_LOOP_MODEL =
  'No model can make loop clips: the models file has no `beatLoop.video` list with a model of a provider whose key is set (MiniMax Hailuo 3 on fal, Gemini Omni Flash on Google)'

/** `long_take/beat_loop.json`. */
export interface BeatLoopFile {
  createdAt: string
  format: 'beat_loop'
  /** Already checked (`validateBeatLoopStoryboard`). */
  storyboard: BeatLoopStoryboard
  /** The look every keyframe and clip prompt ends with: the storyboard's, or the one picked. */
  style: string
  styleName?: string
  updatedAt: string
  version: 1
  /** The voice for every line; the default voice when unset. */
  voiceId?: string
}

/** Every line of a loop said in its voice and measured (`BeatLoopService.checkLines`). */
export interface BeatLoopLinesCheck {
  lines: BeatLoopLineCheck[]
  voice: LoopVoice
}

/** What a loop costs on the model that will make its clips. */
export interface BeatLoopEstimate extends BeatLoopCost {
  /** The other provider's loop model (its key is set): it makes a clip only when the first
   *  model's video call fails on it, at its own price. */
  fallback?: {
    clipUsd: number
    model: string
    modelLabel: string
    provider: GenerationProvider
  }
  /** The clip model's name, as the models file labels it. */
  modelLabel: string
  provider: GenerationProvider
}

/** The parts of a clip a redo may rewrite; the clip's template is filled from them again. */
export type BeatLoopClipChanges = Partial<
  Pick<
    BeatLoopClip,
    'caption' | 'cut' | 'cut_camera' | 'freeze' | 'hit' | 'hit_camera' | 'narration' | 'stamp'
  >
>

/**
 * The slots that are words, not picture: the voice-over and the render make them from the
 * storyboard on every run. The clip's prompt is made from the other slots (and the style), so
 * changing only these keeps the clip.
 */
const WORD_SLOTS: readonly (keyof BeatLoopClipChanges)[] = ['caption', 'narration', 'stamp']

export interface RegenerateLoopClipResult {
  /** The clips this run makes, in order: the redone clip, then any after it it makes again.
   *  With the clip kept (`clipRemade` false), only clips a stopped run never made. */
  clipIds: string[]
  /** False when the changes only touched the clip's words (narration, caption, stamp): the
   *  clip is kept, and the run only voices the lines again and renders. */
  clipRemade: boolean
  /** One 4 s clip on the model Setup picks (every new clip tries it first). */
  clipUsd: number
  estimatedCostUsd: number
  /** The clips after the redone one, kept as they are unless `redoFollowing`. */
  followingClipIds: string[]
  projectId: string
  redoFollowing: boolean
  /** The loop's storyboard as stored, with the changes in it. */
  storyboard: BeatLoopStoryboard
  workflowId: string
}

/**
 * What a new picture as one of the loop's keyframes makes again (`planKeyframeSwap`). The clips
 * are chained: each starts from the real last frame of the one before, and clip k lands on frame
 * k. So the clip landing on the frame and every clip after it are made again; for f0, which the
 * loop opens on and (as its closing copy) lands on, every clip.
 */
export interface LoopKeyframeSwapPlan {
  clipCount: number
  /** The clips made again, in order. */
  clipIds: string[]
  /** One 4 s clip on the model Setup picks (every new clip tries it first). */
  clipUsd: number
  estimatedCostUsd: number
  /** The frame as the storyboard names it (its closing copy fN is f0). */
  frameId: string
  /** The pictures the new one is written over: the frame's, and f0's closing copy with f0. */
  framePaths: string[]
  /** The clip model, as the models file names it. */
  modelLabel: string
}

export interface StartBeatLoopInput {
  /** Recorded on the project, as a long-take start records it (agent mode's harness). */
  debugSettings?: DebugSettings
  projectId: string
  storyboard: BeatLoopStoryboard
  style: string
  styleName?: string
  user: UserInfo
  /** A voice id, or a preset voice's name; the default voice when unset. */
  voice?: string
}

/** The voice a loop's lines are said in. */
export interface LoopVoice {
  /** It runs free on this computer (Kokoro or Qwen3 on the local voice server). */
  free: boolean
  /** The voice id the lines were said in: start the loop with it. */
  id: string
  name: string
}

/** One stored take, as far as a redo reads it; every other field is kept as it is. */
interface QaTake {
  [key: string]: unknown
  /** The clip's generation the take was made in (absent: 1). */
  generation?: number
  lastFrameUri?: string
  /** The loop model that made it. */
  model?: string
  take: number
  transition: null | { [key: string]: unknown; lastFrameUri?: string }
}

/** One clip of the QA record, as far as a redo reads and changes it. */
interface QaClip {
  [key: string]: unknown
  clipId: string
  clipIndex: number
  flagged?: boolean
  /** How often the clip was started over (absent: 1): only takes of this one can be kept. */
  generation?: number
  /** Kept on purpose when the clip before it was redone: reused although it is older. */
  keepAfterRedo?: boolean
  keptTake?: number
  /** Every take of every generation (each was paid for). */
  takes: QaTake[]
}

interface QaFile {
  [key: string]: unknown
  clips: QaClip[]
}

/**
 * What a loop of `clips` clips costs on the model every new clip tries first
 * (`beatLoopModelOrder`): the loop model of the provider Setup picked (fal: MiniMax Hailuo 3,
 * Google: Gemini Omni Flash), else the other provider's when only its key is set. Veo never
 * makes loop clips. `fallback` is the other provider's model, which makes a clip only when the
 * first one's video call fails on it. Throws when no model can.
 */
export function beatLoopEstimate(
  clips: number,
  options: {
    env?: NodeJS.ProcessEnv
    registry?: Pick<ModelRegistryFile, 'beatLoop' | 'models'>
  } = {},
): BeatLoopEstimate {
  const registry = options.registry ?? modelRegistry()
  const [first, second] = beatLoopModelOrder({ ...options, registry })
  const entry = first ? registry.models[first.key] : undefined
  if (!first || !entry) throw new BadRequestException(NO_LOOP_MODEL)
  // beatLoopCost reads a models-file key on its own provider, whichever one Setup picked.
  const cost = beatLoopCost({ clips, model: first.key })
  const other = second ? registry.models[second.key] : undefined
  return {
    ...cost,
    ...(second && other
      ? {
          fallback: {
            clipUsd: beatLoopCost({ clips: 1, model: second.key }).clipUsd,
            model: second.key,
            modelLabel: other.label ?? second.key,
            provider: second.provider,
          },
        }
      : {}),
    modelLabel: entry.label ?? first.key,
    provider: first.provider,
  }
}

/** The run id every loop run of a project shares (as a long-take video's), so they never overlap. */
export function beatLoopWorkflowId(projectId: string): string {
  return getWorkflowId(projectId, 'story-mode')
}

@Injectable()
export class BeatLoopService {
  private readonly logger = new Logger(BeatLoopService.name)
  /** Projects a start or redo is setting up in this process (ReelMakeEasy runs as one process). */
  private readonly starting = new Set<string>()

  constructor(
    private readonly projectsService: ProjectService,
    private readonly mediaService: MediaService,
    private readonly kv: KvStore,
    private readonly prisma: PrismaService,
  ) {}

  /** Try again: a stored loop that is not being made can run again. */
  async canResume(projectId: string): Promise<boolean> {
    if (!(await this.isBeatLoopProject(projectId))) return false
    const storage = await createStorage(projectId)
    if (!(await storage.exists(BEAT_LOOP_PATH))) return false
    return !(await this.isRunning(projectId))
  }

  /**
   * Says every line of the storyboard in the loop's voice and measures it by the voice-over's
   * fit rule, before anything is asked or spent on clips: the voice named (by id, or a preset's
   * name), else a free local voice when one is installed, else the default voice. The run
   * reuses the audio (kept by voice and words), so no line is paid for twice. Start the loop
   * with `voice.id`: the voice the lines were said in.
   */
  async checkLines(input: {
    /** True once the user stopped the chat: no line is said after that (the check throws). */
    shouldStop?: () => boolean
    storyboard: BeatLoopStoryboard
    user: UserInfo
    voice?: string
  }): Promise<BeatLoopLinesCheck> {
    const { storyboard, user } = input
    const requested = await this.resolveVoice(input.voice, user.orgId)
    const voiceId = requested.validatedVoiceId ?? (await defaultLoopVoiceId())
    const userId = user.userId || user.sub
    const check = await checkBeatLoopLines({
      clips: storyboard.clips,
      ...(input.shouldStop ? { shouldStop: input.shouldStop } : {}),
      ...(user.email && userId ? { userContext: { userEmail: user.email, userId } } : {}),
      voiceId,
    })
    // A voice that can't run here (retired, a clone with no key, another provider's) is said
    // in the loop's default voice instead: a free one when installed.
    const name =
      presetPreviewData.find((preset) => preset.voiceId === check.voiceId)?.name ??
      (check.voiceId === requested.validatedVoiceId ? requested.voiceOverJson?.name : undefined) ??
      check.voiceId
    return { lines: check.lines, voice: { free: check.free, id: check.voiceId, name } }
  }

  /** Whether the project is a loop short (made by `start`): its clip tools differ. */
  async isBeatLoopProject(projectId: string): Promise<boolean> {
    const project = await this.projectsService.getProject(projectId)
    return isBeatLoopUseCase(project)
  }

  /** What a new picture as keyframe `frameId` makes again and costs; nothing is changed. Refused
   *  (400) for an unknown frame, a frame not made yet, or clips before it still missing; (409)
   *  while the loop is being made. */
  async planKeyframeSwap(projectId: string, frameId: string): Promise<LoopKeyframeSwapPlan> {
    await this.assertAccess(projectId)
    const storage = await createStorage(projectId)
    const loop = await this.readLoop(projectId, storage)
    const { plan } = await this.keyframeSwap(projectId, storage, loop, frameId)
    return plan
  }

  /**
   * Redoes one clip: its stored takes are set aside, and the loop runs again from the real last
   * frame of the clip before it (clip 1 starts from f0). The clips after it are kept as they
   * are (a small jump where the new clip meets the next), or made again too with
   * `redoFollowing`, each from the clip before. New `changes` to the clip's slots are checked
   * with the whole storyboard and stored before the run. Changes to its words alone
   * (narration, caption, stamp) keep this clip and every other one: the run voices the lines
   * again and renders, paying for no clip but those a stopped run never made.
   */
  async regenerateClip(
    projectId: string,
    clipId: string,
    opts: { changes?: BeatLoopClipChanges; redoFollowing?: boolean },
    user: UserInfo,
  ): Promise<RegenerateLoopClipResult> {
    return this.exclusive(projectId, async () => {
      await this.assertAccess(projectId)
      const storage = await createStorage(projectId)
      const loop = await this.readLoop(projectId, storage)
      const index = loop.storyboard.clips.findIndex((clip) => clip.id === clipId)
      if (index === -1) {
        const ids = loop.storyboard.clips.map((clip) => clip.id).join(', ')
        throw new BadRequestException(`No clip ${clipId || '(none)'}. Clips: ${ids}.`)
      }
      const storyboard = opts.changes
        ? checked(withClipChanges(loop.storyboard, index, opts.changes))
        : loop.storyboard
      const qa = await readQa(storage)
      const changed = changedSlots(loop.storyboard.clips[index], storyboard.clips[index])
      const wordsOnly = changed.length > 0 && changed.every((slot) => WORD_SLOTS.includes(slot))
      const plan = wordsOnly
        ? { clipIds: clipsStillToMake(storyboard, qa), redoFollowing: false }
        : planRedo(storyboard, qa, index, opts.redoFollowing ?? false)
      // Priced on Setup's model, which every new clip tries first, and a loop model found,
      // before anything is changed.
      const { clipUsd } = beatLoopEstimate(1)
      if (await this.isRunning(projectId)) throw new ConflictException(LOOP_BUSY)

      if ('startOver' in plan) {
        for (const clip of qa.clips) {
          if (plan.startOver.has(clip.clipIndex)) startOver(clip)
          else if (plan.keepAfter.has(clip.clipIndex)) clip.keepAfterRedo = true
        }
        await storage.writeJsonFile(BEAT_LOOP_QA_PATH, qa)
      }
      const file: BeatLoopFile = opts.changes
        ? { ...loop, storyboard, updatedAt: new Date().toISOString() }
        : loop
      if (opts.changes) await this.storeChanges(projectId, storage, file, user)

      const { workflowId } = await this.startRun(projectId, file, user)
      this.logger.log(
        `Loop clip redo started ${JSON.stringify({ clipId, clipIds: plan.clipIds, clipRemade: !wordsOnly, projectId, redoFollowing: plan.redoFollowing, workflowId })}`,
      )
      return {
        clipIds: plan.clipIds,
        clipRemade: !wordsOnly,
        clipUsd,
        estimatedCostUsd: cents(plan.clipIds.length * clipUsd),
        followingClipIds: wordsOnly ? [] : storyboard.clips.slice(index + 1).map((clip) => clip.id),
        projectId,
        redoFollowing: plan.redoFollowing,
        storyboard,
        workflowId,
      }
    })
  }

  /** Try again: runs the stored loop again in the same project, from the first clip not kept. */
  async resume(
    projectId: string,
    user: UserInfo,
  ): Promise<{ projectId: string; workflowId: string }> {
    return this.exclusive(projectId, async () => {
      await this.assertAccess(projectId)
      const loop = await this.readLoop(projectId, await createStorage(projectId))
      if (await this.isRunning(projectId)) throw new ConflictException(LOOP_BUSY)
      return this.startRun(projectId, loop, user)
    })
  }

  /**
   * The loop's first start, in a project made for it (`createUseCase: 'beat-loop'`): checks the
   * storyboard, records the narration as the project's script and the voice, writes
   * `long_take/beat_loop.json`, then starts BeatLoopWorkflow.
   */
  async start(input: StartBeatLoopInput): Promise<{ projectId: string; workflowId: string }> {
    const { projectId, user } = input
    return this.exclusive(projectId, async () => {
      const storyboard = checked(input.storyboard)
      const style = input.style.trim()
      if (!style) throw new BadRequestException('A loop short needs a style.')
      if (await this.isRunning(projectId)) throw new ConflictException(LOOP_BUSY)
      const { validatedVoiceId, voiceOverJson } = await this.resolveVoice(input.voice, user.orgId)
      await this.projectsService.internalUpdateProject(
        projectId,
        {
          script: narrationScript(storyboard),
          ...(voiceOverJson ? { voiceOverJson } : {}),
        },
        user.sub,
      )
      if (input.debugSettings) {
        await persistDebugOverrides(
          { projectsService: this.projectsService as never },
          { debugSettings: input.debugSettings, projectId, userSub: user.sub },
        )
      }
      const now = new Date().toISOString()
      const file: BeatLoopFile = {
        createdAt: now,
        format: 'beat_loop',
        storyboard,
        style,
        ...(input.styleName?.trim() ? { styleName: input.styleName.trim() } : {}),
        updatedAt: now,
        version: 1,
        ...(validatedVoiceId ? { voiceId: validatedVoiceId } : {}),
      }
      await (await createStorage(projectId)).writeJsonFile(BEAT_LOOP_PATH, file)
      return this.startRun(projectId, file, user)
    })
  }

  /**
   * Makes `png` (already fitted to the frame) keyframe `frameId`: the old picture is kept beside
   * it (`long_take/keyframes/replaced/`), the new one is written over the frame's (and, for f0,
   * over its closing copy), where the agent looks at it, and under a new name of its own, which
   * the record of the frames and `keyframes.json` now point at (so the page and the clip model
   * never get the old picture from a copy kept for the old address). The clips landing on it
   * and after it start over, and the loop runs again: it reuses every keyframe (their prompts
   * are unchanged) and the clips before, makes those clips again, each from the real last frame
   * of the one before, and renders.
   */
  async swapKeyframe(
    projectId: string,
    frameId: string,
    png: Buffer,
    user: UserInfo,
  ): Promise<LoopKeyframeSwapPlan & { workflowId: string }> {
    return this.exclusive(projectId, async () => {
      await this.assertAccess(projectId)
      const storage = await createStorage(projectId)
      const loop = await this.readLoop(projectId, storage)
      const { frames, plan, qa, redo } = await this.keyframeSwap(projectId, storage, loop, frameId)
      const [framePath] = plan.framePaths
      const stamp = Date.now().toString(36)
      await storage.copyFile(
        framePath,
        `${LOOP_KEYFRAMES_DIR}/replaced/${plan.frameId}-${stamp}.png`,
      )
      const uris = new Map<string, string>()
      for (const picturePath of plan.framePaths) {
        await storage.writeFile(picturePath, png)
        const id = picturePath.slice(LOOP_KEYFRAMES_DIR.length + 1, -'.png'.length)
        const stampedPath = `${LOOP_KEYFRAMES_DIR}/${id}-${stamp}.png`
        await storage.writeFile(stampedPath, png)
        uris.set(id, storage.getFullPath(stampedPath))
      }
      await storage.writeJsonFile(BEAT_LOOP_KEYFRAMES_PATH, {
        ...frames,
        frames: frames.frames.map((frame) => {
          const uri = uris.get(frame.id)
          return uri ? { ...frame, uri } : frame
        }),
      })
      // Written once every frame is made: a loop whose run stopped before has none yet, and
      // its run writes it from the record.
      const keyframes = await readOptionalJsonFile<{ keyframeUrl: string; shotId: string }[]>(
        storage,
        LOOP_KEYFRAMES_JSON_PATH,
      )
      if (Array.isArray(keyframes)) {
        await storage.writeJsonFile(
          LOOP_KEYFRAMES_JSON_PATH,
          keyframes.map((keyframe) => {
            const uri = uris.get(keyframe.shotId)
            return uri ? { ...keyframe, keyframeUrl: uri } : keyframe
          }),
        )
      }
      for (const clip of qa.clips) if (redo.startOver.has(clip.clipIndex)) startOver(clip)
      await storage.writeJsonFile(BEAT_LOOP_QA_PATH, qa)
      const { workflowId } = await this.startRun(projectId, loop, user)
      this.logger.log(
        `Loop keyframe swapped ${JSON.stringify({ clipIds: plan.clipIds, frameId: plan.frameId, projectId, workflowId })}`,
      )
      return { ...plan, workflowId }
    })
  }

  private async assertAccess(projectId: string): Promise<void> {
    if (!(await this.projectsService.canVisitProject(projectId))) {
      throw new UnauthorizedException('You are not authorized to access this project')
    }
  }

  /** Runs `fn` as the only start or redo of the project in flight; another one is refused. */
  private async exclusive<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    if (this.starting.has(projectId)) throw new ConflictException(LOOP_BUSY)
    this.starting.add(projectId)
    try {
      return await fn()
    } finally {
      this.starting.delete(projectId)
    }
  }

  /** A run of the loop is going (or waiting in the admission queue). */
  private async isRunning(projectId: string): Promise<boolean> {
    const client = await createClient()
    try {
      const description = await client.workflow.getHandle(beatLoopWorkflowId(projectId)).describe()
      return description.status.name === 'RUNNING'
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) return false
      throw error
    }
  }

  /** The keyframe swap's plan, with the records it read (the frames, the QA) and the redo it
   *  plans on them. */
  private async keyframeSwap(
    projectId: string,
    storage: Awaited<ReturnType<typeof createStorage>>,
    loop: BeatLoopFile,
    frameId: string,
  ): Promise<{ frames: LoopFrameRecord; plan: LoopKeyframeSwapPlan; qa: QaFile; redo: RedoPlan }> {
    const { storyboard } = loop
    const count = storyboard.clips.length
    const ids = storyboard.keyframes.map((keyframe) => keyframe.id)
    const found = ids.indexOf(frameId)
    if (found === -1) {
      throw new BadRequestException(
        `No keyframe ${frameId || '(none)'}. The keyframes are ${ids.slice(0, count).join(', ')}.`,
      )
    }
    // fN is f0's closing copy: the loop opens on f0 and lands on it.
    const index = found >= count ? 0 : found
    const id = ids[index]
    const closingId = ids[count] ?? `f${count}`
    const framePaths = [
      `${LOOP_KEYFRAMES_DIR}/${id}.png`,
      ...(index === 0 ? [`${LOOP_KEYFRAMES_DIR}/${closingId}.png`] : []),
    ]
    if (!(await storage.exists(framePaths[0]))) {
      throw new BadRequestException(
        `Keyframe ${id} isn't made yet: Try again finishes the loop first.`,
      )
    }
    // The run keeps the frames on record and draws the rest: one missing from it would be drawn
    // again, over the new picture.
    const frames = await readOptionalJsonFile<LoopFrameRecord>(storage, BEAT_LOOP_KEYFRAMES_PATH)
    if (
      !Array.isArray(frames?.frames) ||
      !frames.frames.some((frame) => frame.id === id && !frame.copyOf)
    ) {
      throw new BadRequestException(
        `Keyframe ${id} isn't on the loop's record of its pictures, so making the loop again would draw it anew over the new picture: this loop's pictures can't be swapped.`,
      )
    }
    const qa = await readQa(storage)
    // Clip k lands on frame k: from it on (from clip 1 for f0, where the loop opens).
    const redo = planRedo(storyboard, qa, Math.max(0, index - 1), true)
    const estimate = beatLoopEstimate(1)
    if (await this.isRunning(projectId)) throw new ConflictException(LOOP_BUSY)
    return {
      frames,
      plan: {
        clipCount: count,
        clipIds: redo.clipIds,
        clipUsd: estimate.clipUsd,
        estimatedCostUsd: cents(redo.clipIds.length * estimate.clipUsd),
        frameId: id,
        framePaths,
        modelLabel: estimate.modelLabel,
      },
      qa,
      redo,
    }
  }

  /** The stored loop of a loop-short project; a 400 for any other project. */
  private async readLoop(
    projectId: string,
    storage: Awaited<ReturnType<typeof createStorage>>,
  ): Promise<BeatLoopFile> {
    if (!(await this.isBeatLoopProject(projectId))) throw new BadRequestException(NOT_A_LOOP)
    let raw: Partial<BeatLoopFile> | undefined
    try {
      raw = await storage.readJsonFile<Partial<BeatLoopFile>>(BEAT_LOOP_PATH)
    } catch {
      raw = undefined
    }
    const style = (raw?.style ?? raw?.storyboard?.style ?? '').trim()
    if (!raw?.storyboard || !style) {
      throw new BadRequestException("This loop short's storyboard is missing: make it again.")
    }
    return { ...raw, style } as BeatLoopFile
  }

  /** A voice named by id or by a preset's name, as a long-take start checks it (another
   *  account's clone is dropped). */
  private resolveVoice(
    voice: string | undefined,
    orgId: string | undefined,
  ): Promise<ResolvedRequestVoice> {
    return resolveLongTakeRequestVoice(
      { logger: this.logger, prisma: this.prisma },
      presetVoiceId(voice),
      orgId,
    )
  }

  /** Starts BeatLoopWorkflow for the stored loop, as a long-take start goes through admission. */
  private async startRun(
    projectId: string,
    loop: BeatLoopFile,
    user: UserInfo,
  ): Promise<{ projectId: string; workflowId: string }> {
    const project = await this.projectsService.getProject(projectId)
    // Music the user added since (off for a new loop): the run's render keeps it.
    const music = resolveEffectiveBgm(project ?? {})
    const workflowArgs: Record<string, unknown> = {
      ...(music.bedUri ? { bgmBedUri: music.bedUri, bgmVolume: music.bgmVolume } : {}),
      // On unless the user turned the captions off since (the caption toggle).
      enableCaption: project?.enableCaption ?? true,
      ...(user.orgId ? { orgId: user.orgId } : {}),
      projectId,
      storyboard: loop.storyboard,
      style: loop.style,
      userEmail: user.email,
      userId: user.sub,
      ...(loop.voiceId ? { voiceId: loop.voiceId } : {}),
    }
    return startStandaloneAdmissionWorkflow(
      { kv: this.kv, logger: this.logger, mediaService: this.mediaService as never },
      createClient as never,
      buildQueuedAdmissionMeta,
      {
        resolvedProjectId: projectId,
        taskQueue: await resolveStoryModeTaskQueue(),
        user,
        workflowArgs,
        workflowId: beatLoopWorkflowId(projectId),
        workflowName: BEAT_LOOP_WORKFLOW_NAME,
      },
    )
  }

  /** A redo's new slots: the stored loop, and the project's script when a line changed. */
  private async storeChanges(
    projectId: string,
    storage: Awaited<ReturnType<typeof createStorage>>,
    file: BeatLoopFile,
    user: UserInfo,
  ): Promise<void> {
    await storage.writeJsonFile(BEAT_LOOP_PATH, file)
    await this.projectsService.internalUpdateProject(
      projectId,
      { script: narrationScript(file.storyboard) },
      user.sub,
    )
  }
}

/** A project row made as a loop short. */
export function isBeatLoopUseCase(project: unknown): boolean {
  return (project as null | { createUseCase?: null | string })?.createUseCase === BEAT_LOOP_USE_CASE
}

/** The storyboard as checked, or a 400 naming every issue. */
function checked(storyboard: BeatLoopStoryboard): BeatLoopStoryboard {
  const result = validateBeatLoopStoryboard(storyboard)
  if (!result.ok) {
    throw new BadRequestException(`The storyboard needs fixing: ${result.issues.join('; ')}`)
  }
  return result.storyboard
}

const cents = (usd: number): number => Math.round(usd * 100) / 100

/** The kept take of a stored clip, of its current generation, when it produced a clip. */
function keptTakeOf(clip: QaClip | undefined): QaTake | undefined {
  const generation = clip?.generation ?? 1
  return clip?.takes.find(
    (take) =>
      take.take === clip.keptTake && take.transition && (take.generation ?? 1) === generation,
  )
}

function lastFrameOf(take: QaTake): string | undefined {
  return take.lastFrameUri ?? take.transition?.lastFrameUri
}

/** A voice named by a preset's name ("Rachel") as its id; anything else as it is. */
function presetVoiceId(voice: string | undefined): string | undefined {
  const wanted = voice?.trim()
  if (!wanted) return undefined
  const byName = presetPreviewData.find(
    (preset) => preset.voiceId !== wanted && preset.name?.toLowerCase() === wanted.toLowerCase(),
  )
  return byName?.voiceId ?? wanted
}

/**
 * Reads the QA record; empty only before the first clip. A record that is there but can't be
 * read refuses the redo: read as empty and written back, it would lose every paid take, and
 * the run would pay for every clip again.
 */
async function readQa(storage: Awaited<ReturnType<typeof createStorage>>): Promise<QaFile> {
  let file: QaFile
  try {
    file = await storage.readJsonFile<QaFile>(BEAT_LOOP_QA_PATH)
  } catch (error) {
    if (isMissingObjectError(error)) {
      return { clips: [], spend: { estimatedUsd: 0, takes: 0 }, updatedAt: '', version: 1 }
    }
    throw new InternalServerErrorException(
      `${BEAT_LOOP_QA_PATH} can't be read: ${ensureError(error).message}. It records every clip already paid for, so nothing was changed: fix the file, or delete it to make every clip again.`,
    )
  }
  return { ...file, clips: Array.isArray(file?.clips) ? file.clips : [] }
}

/** The loop's narration as the project's script: every line in order, one per clip (as the
 *  voice-over's script.txt), so each shows as a line of its own wherever the script is read. */
function narrationScript(storyboard: BeatLoopStoryboard): string {
  return storyboard.clips.map((clip) => clip.narration.trim()).join('\n')
}

/** What a redo of clip `index` does to the stored clips, and what it makes. */
interface RedoPlan {
  /** The clips the run makes, in order: the redone clip, then any after it it makes again. */
  clipIds: string[]
  /** Clips after it kept as they are (`keepAfterRedo`). */
  keepAfter: Set<number>
  redoFollowing: boolean
  /** Clips that start over (a new generation): the redone clip and every clip made again. */
  startOver: Set<number>
}

/**
 * Checks a redo of clip `index` can run (every clip before it kept, the one right before with a
 * last frame to start from, clip 1 not stopped at the gate) and plans it. Without redoFollowing
 * the kept clips right after it stay; the first one missing, and every clip after that, is made
 * anyway (each starts from the clip before).
 */
function planRedo(
  storyboard: BeatLoopStoryboard,
  qa: QaFile,
  index: number,
  redoFollowing: boolean,
): RedoPlan {
  const stored = (i: number) => storedClip(storyboard, qa, i)
  const kept = (i: number) => keptTakeOf(stored(i))
  const first = storyboard.clips[0].id
  if (index > 0 && stored(0)?.flagged) {
    throw new BadRequestException(
      `Clip ${first} failed its checks, so the loop stopped there: redo clip ${first} first.`,
    )
  }
  for (let i = 0; i < index; i++) {
    const take = kept(i)
    if (!take || (i === index - 1 && !lastFrameOf(take))) {
      throw new BadRequestException(
        `Clip ${storyboard.clips[i].id} isn't made yet, so clip ${storyboard.clips[index].id} has no frame to start from. Try again finishes the loop first.`,
      )
    }
  }
  let keepUntil = index + 1
  if (!redoFollowing) while (keepUntil < storyboard.clips.length && kept(keepUntil)) keepUntil++
  const keepAfter = new Set<number>()
  const startOver = new Set<number>([index])
  for (let i = index + 1; i < storyboard.clips.length; i++) {
    if (i < keepUntil) keepAfter.add(i)
    else startOver.add(i)
  }
  return {
    clipIds: storyboard.clips.filter((_, i) => startOver.has(i)).map((clip) => clip.id),
    keepAfter,
    redoFollowing,
    startOver,
  }
}

/** Clip `i` of the storyboard as the QA record has it (same id, same place). */
function storedClip(storyboard: BeatLoopStoryboard, qa: QaFile, i: number): QaClip | undefined {
  return qa.clips.find((clip) => clip.clipIndex === i && clip.clipId === storyboard.clips[i].id)
}

/**
 * The clips the next run makes when none is redone, as Try again would: from the first clip
 * not kept (or clip 1 stopped at its checks) on, but for the clips kept on purpose right after
 * it (`keepAfterRedo`). None for a finished loop. The run's own check of the chain can only
 * find more.
 */
function clipsStillToMake(storyboard: BeatLoopStoryboard, qa: QaFile): string[] {
  const stored = (i: number) => storedClip(storyboard, qa, i)
  const count = storyboard.clips.length
  const gap = storyboard.clips.findIndex(
    (_, i) => !keptTakeOf(stored(i)) || (i === 0 && stored(0)?.flagged),
  )
  if (gap === -1) return []
  let next = gap + 1
  while (next < count && stored(next)?.keepAfterRedo && keptTakeOf(stored(next))) next++
  return [gap, ...Array.from({ length: count - next }, (_, k) => next + k)].map(
    (i) => storyboard.clips[i].id,
  )
}

/** The slots a redo's changes really changed (a slot set to what it was is no change). */
function changedSlots(before: BeatLoopClip, after: BeatLoopClip): (keyof BeatLoopClipChanges)[] {
  return CLIP_SLOTS.filter((slot) => before[slot] !== after[slot])
}

/**
 * A clip started over: a new generation, so the run makes and keeps a new take. Its old takes
 * stay on record (they were paid for) under the old generation, and their files stay as they
 * are: new takes are numbered after them.
 */
function startOver(clip: QaClip): void {
  clip.generation = (clip.generation ?? 1) + 1
  delete clip.keptTake
  delete clip.flagged
  delete clip.keepAfterRedo
}

/** Every slot a redo may rewrite. */
const CLIP_SLOTS = [
  'caption',
  'cut',
  'cut_camera',
  'freeze',
  'hit',
  'hit_camera',
  'narration',
  'stamp',
] as const satisfies readonly (keyof BeatLoopClipChanges)[]

/** The storyboard with one clip's slots rewritten (only the fields a redo may change). */
function withClipChanges(
  storyboard: BeatLoopStoryboard,
  index: number,
  changes: BeatLoopClipChanges,
): BeatLoopStoryboard {
  const patch = Object.fromEntries(
    CLIP_SLOTS.filter((k) => k in changes).map((k) => [k, changes[k]]),
  )
  return {
    ...storyboard,
    clips: storyboard.clips.map((clip, i) => (i === index ? { ...clip, ...patch } : clip)),
  }
}
