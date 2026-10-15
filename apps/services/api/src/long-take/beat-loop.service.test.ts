// An in-memory project store. A file set to CORRUPT reads as JSON cut short.
const files = new Map<string, unknown>()
const CORRUPT = 'corrupt file'
jest.mock('@reelmakeeasy/common/agent-v2/storage/storage', () => ({
  createStorage: async (projectId: string) => ({
    copyFile: async (from: string, to: string) => {
      const key = `${projectId}/${from}`
      if (!files.has(key)) throw Object.assign(new Error(`No such object: ${key}`), { code: 404 })
      files.set(`${projectId}/${to}`, files.get(key))
    },
    exists: async (p: string) => files.has(`${projectId}/${p}`),
    getFullPath: (p: string) => `store://${projectId}/${p}`,
    writeFile: async (p: string, content: Buffer) => {
      files.set(`${projectId}/${p}`, content)
      return p
    },
    readJsonFile: async (p: string) => {
      const key = `${projectId}/${p}`
      if (!files.has(key)) throw Object.assign(new Error(`No such object: ${key}`), { code: 404 })
      if (files.get(key) === CORRUPT) throw new SyntaxError('Unexpected end of JSON input')
      return structuredClone(files.get(key))
    },
    writeJsonFile: async (p: string, data: unknown) => {
      files.set(`${projectId}/${p}`, structuredClone(data))
      return p
    },
  }),
}))
const describeRun = jest.fn()
jest.mock('@reelmakeeasy/common/workflow/client', () => ({
  createClient: async () => ({ workflow: { getHandle: () => ({ describe: describeRun }) } }),
}))
const startAdmission = jest.fn()
jest.mock('./admission-helpers', () => ({
  startStandaloneAdmissionWorkflow: (...args: unknown[]) => startAdmission(...args),
}))
jest.mock('./long-take-workflow.util', () => ({
  ...jest.requireActual('./long-take-workflow.util'),
  resolveStoryModeTaskQueue: async () => 'ao-story-mode',
}))
// The voice is faked: `checkBeatLoopLines` says the lines (TTS, paid for some voices).
const checkVoice = jest.fn()
jest.mock('@agent-lib/agents/story-loader/voice-tools/utils/beat-loop-lines.util', () => ({
  checkBeatLoopLines: (...args: unknown[]) => checkVoice(...args),
}))
/** What `defaultLoopVoiceId` answers: a free local voice when one is installed. */
let defaultLoopVoice = 'kokoro-af_heart'
jest.mock('@reelmakeeasy/common/tts/default-voice', () => ({
  ...jest.requireActual('@reelmakeeasy/common/tts/default-voice'),
  defaultLoopVoiceId: async () => defaultLoopVoice,
}))

import {
  beatLoopCost,
  EXPLAINER_COLLAGE_STYLE,
  validateBeatLoopStoryboard,
} from '@reelmakeeasy/common/long-take/beat-loop-craft'
import {
  modelRegistry,
  type ModelRegistryFile,
  resetGenerationProviderForTesting,
  setGenerationProvider,
} from '@reelmakeeasy/llm/registry'
import { WorkflowNotFoundError } from '@reelmakeeasy/workflow-engine/common'
import { BadRequestException, ConflictException } from '@nestjs/common'
import type { BeatLoopStoryboard } from '@shared/types/api/agent'

import {
  BEAT_LOOP_PATH,
  BEAT_LOOP_QA_PATH,
  BEAT_LOOP_WORKFLOW_NAME,
  beatLoopEstimate,
  BeatLoopService,
} from './beat-loop.service'

const USER = { email: 'you@reelmakeeasy.local', orgId: 'o', sub: 'u', userId: 'u' }
const WORKFLOW_ID = 'ao:p1:story-mode'

/** A 16 s loop (four clips) that passes every storyboard check. */
function honeyStoryboard(): BeatLoopStoryboard {
  return {
    accent: '#FFE500',
    clips: [
      {
        caption: null,
        cut: 'The camera dives fast into a single drop until its golden surface fills the whole frame.',
        cut_camera: 'Zoom in',
        freeze: 'The drips freeze mid-air, glossy and still.',
        hit: 'The honey jar cutout slams onto the page as golden drips burst out from its rim.',
        hit_camera: 'Push in',
        id: 'c1',
        narration: 'Honey found in ancient tombs was still good to eat.',
        stamp: 'c. 1325 BC',
      },
      {
        caption: null,
        cut: 'The camera pulls out fast to show a hive cutout on torn paper.',
        cut_camera: 'Pull out',
        freeze: 'The bees hang in a ring, wings blurred.',
        hit: 'Bees swarm out of the drop in a fast spiral as a red marker circle scribbles around them.',
        hit_camera: 'Shake',
        id: 'c2',
        narration: 'Bees fan the nectar with their wings to dry it.',
        stamp: null,
      },
      {
        caption: null,
        cut: 'The camera tilts down fast to a clay pot cutout at the bottom of the page.',
        cut_camera: 'Tilt down',
        freeze: 'The comb holds still, every cell full and shining.',
        hit: 'The hive cutout cracks open and honeycomb cells snap into place one after another.',
        hit_camera: 'Zoom in',
        id: 'c3',
        narration: 'That leaves too little water for any germ to grow.',
        stamp: null,
      },
      {
        caption: null,
        cut: 'The camera whip-pans fast to the right, back to the honey jar cutout on the page.',
        cut_camera: 'Pan right',
        freeze: 'The lid hangs in the air above the pot.',
        hit: 'The clay pot lid flies off and a yellow highlighter stroke swipes across the pot.',
        hit_camera: 'Push in',
        id: 'c4',
        narration: 'So a jar of honey can outlast all of us.',
        stamp: null,
      },
    ],
    duration_s: 16,
    keyframes: [
      { id: 'f0', prompt: 'A honey jar cutout in the middle of the page.' },
      { id: 'f1', prompt: 'A single golden honey drop, close up.' },
      { id: 'f2', prompt: 'A hive cutout on torn paper.' },
      { id: 'f3', prompt: 'A clay pot cutout at the bottom of the page.' },
      { id: 'f4', same_as: 'f0' },
    ],
    sources: 'Smithsonian Magazine',
    style: EXPLAINER_COLLAGE_STYLE,
    title: 'Honey never spoils',
  }
}

/** One stored take of a clip, as the beat-loop activities save it. */
function take(clipId: string, n: number, createdAt: string, passed = true) {
  return {
    clipId,
    createdAt,
    failed: passed ? [] : ['joint'],
    failures: passed ? [] : ['The joint jumps.'],
    lastFrameUri: `store://projects/p1/long_take/transitions/${clipId}_t${n}_last.png`,
    model: 'minimax-h3-max-turbo',
    passed,
    spend: { estimatedUsd: 0.16 },
    take: n,
    transition: { transitionId: clipId, videoUri: `store://${clipId}_t${n}.mp4` },
  }
}

/** The QA record of a finished loop: one kept take per clip, made in order. */
function finishedQa() {
  return {
    clips: ['c1', 'c2', 'c3', 'c4'].map((clipId, clipIndex) => ({
      clipId,
      clipIndex,
      flagged: false,
      keptTake: 1,
      takes: [take(clipId, 1, `2026-10-11T10:0${clipIndex}:00.000Z`)],
    })),
    spend: { estimatedUsd: 0.64, takes: 4 },
    updatedAt: '2026-10-11T10:04:00.000Z',
    version: 1,
  }
}

function makeService(project: Record<string, unknown> = {}) {
  const projectsService = {
    canVisitProject: jest.fn(async () => true),
    getProject: jest.fn(async () => ({
      createUseCase: 'beat-loop',
      enableCaption: true,
      id: 'p1',
      ...project,
    })),
    internalUpdateProject: jest.fn(async () => undefined),
  }
  const prisma = { userVoiceClone: { findMany: jest.fn(async () => []) } }
  const svc = new BeatLoopService(
    projectsService as never,
    {} as never,
    {} as never,
    prisma as never,
  )
  return { prisma, projectsService, svc }
}

function storeLoop(storyboard = honeyStoryboard()) {
  files.set(`p1/${BEAT_LOOP_PATH}`, {
    createdAt: '2026-10-11T10:00:00.000Z',
    format: 'beat_loop',
    storyboard,
    style: storyboard.style,
    styleName: 'Explainer collage',
    updatedAt: '2026-10-11T10:00:00.000Z',
    version: 1,
    voiceId: 'voice-1',
  })
}

/** The workflow args of the n-th admission start. */
const startedArgs = (n = 0) =>
  (startAdmission.mock.calls[n][3] as { workflowArgs: Record<string, unknown> }).workflowArgs

/** A clip of the stored QA record, by id. */
const qaClip = (clipId: string) =>
  (files.get(`p1/${BEAT_LOOP_QA_PATH}`) as ReturnType<typeof finishedQa>).clips.find(
    (clip) => clip.clipId === clipId,
  ) as Record<string, unknown>

beforeEach(() => {
  files.clear()
  describeRun.mockReset().mockRejectedValue(new WorkflowNotFoundError('none', WORKFLOW_ID, ''))
  startAdmission
    .mockReset()
    .mockImplementation(
      async (_d, _c, _m, p: { resolvedProjectId: string; workflowId: string }) => ({
        projectId: p.resolvedProjectId,
        workflowId: p.workflowId,
      }),
    )
  setGenerationProvider('fal')
})
afterEach(() => resetGenerationProviderForTesting())

it('the fixture passes the storyboard checks', () => {
  expect(validateBeatLoopStoryboard(honeyStoryboard()).ok).toBe(true)
})

describe('BeatLoopService.start', () => {
  it('writes the loop file and starts BeatLoopWorkflow through the admission queue', async () => {
    const { projectsService, svc } = makeService()
    const storyboard = honeyStoryboard()

    await expect(
      svc.start({
        projectId: 'p1',
        storyboard,
        style: 'Paper collage',
        styleName: 'Collage',
        user: USER as never,
      }),
    ).resolves.toEqual({ projectId: 'p1', workflowId: WORKFLOW_ID })

    expect(files.get(`p1/${BEAT_LOOP_PATH}`)).toEqual(
      expect.objectContaining({
        format: 'beat_loop',
        storyboard,
        style: 'Paper collage',
        styleName: 'Collage',
        version: 1,
      }),
    )
    const [, , , params] = startAdmission.mock.calls[0]
    expect(params).toEqual(
      expect.objectContaining({
        resolvedProjectId: 'p1',
        taskQueue: 'ao-story-mode',
        workflowId: WORKFLOW_ID,
        workflowName: BEAT_LOOP_WORKFLOW_NAME,
      }),
    )
    expect(startedArgs()).toEqual({
      enableCaption: true,
      orgId: 'o',
      projectId: 'p1',
      storyboard,
      style: 'Paper collage',
      userEmail: USER.email,
      userId: 'u',
    })
    // The narration is the project's script, as a story video's voice-over is: one line per
    // clip, so the chat's Script panel shows each line on its own (a line ending in a quote
    // can't be told from the next by its punctuation).
    expect(projectsService.internalUpdateProject).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        script: storyboard.clips.map((clip) => clip.narration).join('\n'),
      }),
      'u',
    )
  })

  it('passes a voice named by its preset name as its id, and keeps it in the loop file', async () => {
    const { projectsService, svc } = makeService()
    const { presetPreviewData } = jest.requireActual('../voice-over/voice-over') as {
      presetPreviewData: { name: string; voiceId: string }[]
    }
    const preset = presetPreviewData[0]

    await svc.start({
      projectId: 'p1',
      storyboard: honeyStoryboard(),
      style: 'Paper collage',
      user: USER as never,
      voice: preset.name.toUpperCase(),
    })

    expect(startedArgs().voiceId).toBe(preset.voiceId)
    expect(files.get(`p1/${BEAT_LOOP_PATH}`)).toEqual(
      expect.objectContaining({ voiceId: preset.voiceId }),
    )
    expect(projectsService.internalUpdateProject).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        voiceOverJson: expect.objectContaining({ voiceId: preset.voiceId }),
      }),
      'u',
    )
  })

  it('refuses a storyboard that fails the checks, naming every issue, before anything is written', async () => {
    const { svc } = makeService()
    const storyboard = honeyStoryboard()
    storyboard.clips[0].narration = 'Too short.'
    storyboard.clips[1].stamp = 'A stamp far too long for the corner'

    const start = svc.start({ projectId: 'p1', storyboard, style: 'x', user: USER as never })
    await expect(start).rejects.toBeInstanceOf(BadRequestException)
    await expect(start).rejects.toThrow(/clips\[0\]\.narration.*clips\[1\]\.stamp/s)
    expect(files.size).toBe(0)
    expect(startAdmission).not.toHaveBeenCalled()
  })

  it('refuses while a run of the loop is still going, without starting another', async () => {
    const { svc } = makeService()
    describeRun.mockResolvedValue({ status: { name: 'RUNNING' }, type: BEAT_LOOP_WORKFLOW_NAME })

    const start = svc.start({
      projectId: 'p1',
      storyboard: honeyStoryboard(),
      style: 'x',
      user: USER as never,
    })
    await expect(start).rejects.toBeInstanceOf(ConflictException)
    expect(startAdmission).not.toHaveBeenCalled()
  })
})

describe('BeatLoopService.checkLines', () => {
  /** The check as the voice answers it: every line said in `voiceId`, the second too long. */
  const said = (voiceId: string, free: boolean) => ({
    free,
    lines: honeyStoryboard().clips.map((clip, clipIndex) => ({
      clipId: clip.id,
      clipIndex,
      fits: clipIndex !== 1,
      narration: clip.narration,
      seconds: clipIndex === 1 ? 4.9 : 3,
      tempo: clipIndex === 1 ? 4.9 / 3.45 : 1,
    })),
    provider: free ? 'kokoro' : 'elevenlabs',
    voiceId,
  })
  beforeEach(() => {
    defaultLoopVoice = 'kokoro-af_heart'
    checkVoice
      .mockReset()
      .mockImplementation(async ({ voiceId }: { voiceId: string }) =>
        said(voiceId, voiceId.startsWith('kokoro-')),
      )
  })

  it("says every line in the loop's default voice, a free local one when installed", async () => {
    const { svc } = makeService()
    const storyboard = honeyStoryboard()

    const check = await svc.checkLines({ storyboard, user: USER as never })

    expect(checkVoice).toHaveBeenCalledWith({
      clips: storyboard.clips,
      userContext: { userEmail: USER.email, userId: 'u' },
      voiceId: 'kokoro-af_heart',
    })
    expect(check.voice).toEqual({ free: true, id: 'kokoro-af_heart', name: 'Kokoro Heart' })
    expect(check.lines.map((line) => line.fits)).toEqual([true, false, true, true])
    expect(files.size).toBe(0)
    expect(startAdmission).not.toHaveBeenCalled()
  })

  it('says the lines in a voice named by its preset name, and names it', async () => {
    const { svc } = makeService()
    const check = await svc.checkLines({
      storyboard: honeyStoryboard(),
      user: USER as never,
      voice: 'sarah',
    })
    expect(checkVoice).toHaveBeenCalledWith(
      expect.objectContaining({ voiceId: 'EXAVITQu4vr4xnSDxMaL' }),
    )
    expect(check.voice).toEqual({ free: false, id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah' })
  })

  it('names the voice the lines were said in when the one asked for was replaced', async () => {
    const { svc } = makeService()
    // A voice that can't run here is said in the loop's default voice: free when installed.
    checkVoice.mockResolvedValueOnce(said('kokoro-af_heart', true))
    const check = await svc.checkLines({
      storyboard: honeyStoryboard(),
      user: USER as never,
      voice: 'a-retired-voice',
    })
    expect(check.voice).toEqual({ free: true, id: 'kokoro-af_heart', name: 'Kokoro Heart' })
  })

  it('passes a Stop on to the check, so no line is said after it', async () => {
    const { svc } = makeService()
    const shouldStop = () => true
    await svc.checkLines({ shouldStop, storyboard: honeyStoryboard(), user: USER as never })
    expect(checkVoice).toHaveBeenCalledWith(expect.objectContaining({ shouldStop }))
  })

  it("never says the lines in another account's clone: the default loop voice instead", async () => {
    const { prisma, svc } = makeService()
    prisma.userVoiceClone.findMany.mockResolvedValueOnce([
      {
        createdAt: new Date(),
        id: 'c1',
        name: 'Their voice',
        orgId: 'another-org',
        provider: 'qwen3',
        voiceId: 'their-clone',
      },
    ] as never)
    await svc.checkLines({
      storyboard: honeyStoryboard(),
      user: USER as never,
      voice: 'their-clone',
    })
    expect(checkVoice).toHaveBeenCalledWith(expect.objectContaining({ voiceId: 'kokoro-af_heart' }))
  })

  it("names one of the user's clones by its name", async () => {
    const { prisma, svc } = makeService()
    prisma.userVoiceClone.findMany.mockResolvedValue([
      {
        createdAt: new Date(),
        id: 'c1',
        name: 'My voice',
        orgId: 'o',
        provider: 'qwen3',
        voiceId: 'my-clone',
      },
    ] as never)
    checkVoice.mockResolvedValueOnce(said('my-clone', true))
    const check = await svc.checkLines({
      storyboard: honeyStoryboard(),
      user: USER as never,
      voice: 'my-clone',
    })
    expect(check.voice).toEqual({ free: true, id: 'my-clone', name: 'My voice' })
  })
})

describe('BeatLoopService.resume (Try again)', () => {
  it('starts the stored loop again in the same project, leaving the kept clips to the workflow', async () => {
    const { svc } = makeService({ enableCaption: false })
    storeLoop()
    files.set(`p1/${BEAT_LOOP_QA_PATH}`, finishedQa())

    await expect(svc.resume('p1', USER as never)).resolves.toEqual({
      projectId: 'p1',
      workflowId: WORKFLOW_ID,
    })
    expect(startedArgs()).toEqual(
      expect.objectContaining({
        // The user turned the captions off since: the run keeps them off.
        enableCaption: false,
        storyboard: honeyStoryboard(),
        style: EXPLAINER_COLLAGE_STYLE,
        voiceId: 'voice-1',
      }),
    )
    expect(files.get(`p1/${BEAT_LOOP_QA_PATH}`)).toEqual(finishedQa())
  })

  it('keeps the music the user added on the run, at its level, and adds none when it is off', async () => {
    storeLoop()
    const bed = 'store://projects/p1/bgm/bed-1.mp3'
    const on = makeService({ bgmBedUri: bed, bgmEnabled: true, bgmVolume: 35 })
    await on.svc.resume('p1', USER as never)
    expect(startedArgs(0)).toEqual(expect.objectContaining({ bgmBedUri: bed, bgmVolume: 35 }))

    const off = makeService({ bgmBedUri: bed, bgmEnabled: false, bgmVolume: 35 })
    await off.svc.resume('p1', USER as never)
    expect(startedArgs(1)).not.toHaveProperty('bgmBedUri')
  })

  it('refuses a project that is not a loop short', async () => {
    const { svc } = makeService({ createUseCase: null })
    await expect(svc.resume('p1', USER as never)).rejects.toBeInstanceOf(BadRequestException)
  })

  it('canResume: a stored loop that is not running', async () => {
    const { svc } = makeService()
    await expect(svc.canResume('p1')).resolves.toBe(false)
    storeLoop()
    await expect(svc.canResume('p1')).resolves.toBe(true)
    describeRun.mockResolvedValue({ status: { name: 'RUNNING' }, type: BEAT_LOOP_WORKFLOW_NAME })
    await expect(svc.canResume('p1')).resolves.toBe(false)
  })
})

describe('BeatLoopService.regenerateClip', () => {
  it('redoes one clip from the last frame of the one before, keeping the clips after it', async () => {
    const { svc } = makeService()
    storeLoop()
    files.set(`p1/${BEAT_LOOP_QA_PATH}`, finishedQa())

    const result = await svc.regenerateClip('p1', 'c2', {}, USER as never)

    const clipUsd = beatLoopCost({ clips: 1, model: 'minimax-h3-max-turbo' }).clipUsd
    expect(result).toEqual({
      clipIds: ['c2'],
      clipRemade: true,
      clipUsd,
      estimatedCostUsd: clipUsd,
      followingClipIds: ['c3', 'c4'],
      projectId: 'p1',
      redoFollowing: false,
      storyboard: expect.objectContaining({ clips: expect.any(Array) }),
      workflowId: WORKFLOW_ID,
    })
    // The clip starts over: a new generation, so the run makes and keeps a new take. Its old
    // take stays on record (it was paid for), and its files stay as they are.
    expect(qaClip('c2')).toEqual({
      clipId: 'c2',
      clipIndex: 1,
      generation: 2,
      takes: finishedQa().clips[1].takes,
    })
    // The clip before is the chain's start: untouched, so the run starts from its last frame.
    expect(qaClip('c1')).toEqual(finishedQa().clips[0])
    // The clips after are kept as they are, although they are older than the redone clip.
    expect(qaClip('c3')).toEqual({ ...finishedQa().clips[2], keepAfterRedo: true })
    expect(qaClip('c4')).toEqual({ ...finishedQa().clips[3], keepAfterRedo: true })
    expect(startedArgs()).toEqual(expect.objectContaining({ projectId: 'p1', voiceId: 'voice-1' }))
  })

  it('with redoFollowing, redoes the clip and every clip after it', async () => {
    const { svc } = makeService()
    storeLoop()
    files.set(`p1/${BEAT_LOOP_QA_PATH}`, finishedQa())

    const result = await svc.regenerateClip('p1', 'c3', { redoFollowing: true }, USER as never)

    expect(result.clipIds).toEqual(['c3', 'c4'])
    expect(result.estimatedCostUsd).toBeCloseTo(2 * result.clipUsd, 5)
    for (const id of ['c3', 'c4']) {
      expect(qaClip(id)).toEqual(expect.objectContaining({ generation: 2 }))
      expect(qaClip(id).keptTake).toBeUndefined()
      expect(qaClip(id).takes).toHaveLength(1)
    }
    expect(qaClip('c2')).toEqual(finishedQa().clips[1])
  })

  it('counts the clips after it that were never made: the run makes them anyway', async () => {
    const { svc } = makeService()
    storeLoop()
    const qa = finishedQa()
    qa.clips = qa.clips.slice(0, 3)
    files.set(`p1/${BEAT_LOOP_QA_PATH}`, qa)

    const result = await svc.regenerateClip('p1', 'c2', {}, USER as never)
    expect(result.clipIds).toEqual(['c2', 'c4'])
    expect(qaClip('c3').keepAfterRedo).toBe(true)
  })

  it('starts over every clip it makes again, a kept one after a missing one included', async () => {
    const { svc } = makeService()
    storeLoop()
    const qa = finishedQa()
    // c3 was never kept (its run stopped there); c4 has a kept take from an older chain.
    delete (qa.clips[2] as { keptTake?: number }).keptTake
    files.set(`p1/${BEAT_LOOP_QA_PATH}`, qa)

    const result = await svc.regenerateClip('p1', 'c2', {}, USER as never)

    expect(result.clipIds).toEqual(['c2', 'c3', 'c4'])
    for (const id of ['c2', 'c3', 'c4']) expect(qaClip(id).generation).toBe(2)
    expect(qaClip('c4').keptTake).toBeUndefined()
  })

  it("prices a redo on Setup's model, which every new clip tries first, whatever the others used", async () => {
    const { svc } = makeService()
    storeLoop()
    const qa = finishedQa()
    // H3 failed on these clips once, so Omni made them; Setup still picks fal.
    for (const clip of qa.clips) clip.takes[0].model = 'omni-flash-google'
    files.set(`p1/${BEAT_LOOP_QA_PATH}`, qa)
    process.env['GEMINI_API_KEY'] = 'test-gemini'
    try {
      const h3 = beatLoopCost({ clips: 1, model: 'minimax-h3-max-turbo' }).clipUsd
      expect((await svc.regenerateClip('p1', 'c3', {}, USER as never)).clipUsd).toBe(h3)
      expect((await svc.regenerateClip('p1', 'c1', {}, USER as never)).clipUsd).toBe(h3)
    } finally {
      delete process.env['GEMINI_API_KEY']
    }
  })

  it('applies new slots to the clip, checks them and stores the new storyboard', async () => {
    const { svc } = makeService()
    storeLoop()
    files.set(`p1/${BEAT_LOOP_QA_PATH}`, finishedQa())
    const hit = 'The jar lid pops off and honey sprays out in a fast golden arc.'

    const result = await svc.regenerateClip(
      'p1',
      'c1',
      // A new hit and a new caption: the clip's prompt changes, so it is made again.
      { changes: { caption: 'Still good', hit, hit_camera: 'Shake' } },
      USER as never,
    )
    expect(result).toMatchObject({ clipIds: ['c1'], clipRemade: true })
    expect(qaClip('c1').generation).toBe(2)

    const stored = files.get(`p1/${BEAT_LOOP_PATH}`) as { storyboard: BeatLoopStoryboard }
    expect(stored.storyboard.clips[0]).toEqual(
      expect.objectContaining({ hit, hit_camera: 'Shake', id: 'c1' }),
    )
    expect((startedArgs().storyboard as BeatLoopStoryboard).clips[0].hit).toBe(hit)

    const bad = svc.regenerateClip(
      'p1',
      'c1',
      { changes: { freeze: 'The camera zooms in on the jar.' } },
      USER as never,
    )
    await expect(bad).rejects.toBeInstanceOf(BadRequestException)
    await expect(bad).rejects.toThrow(/clips\[0\]\.freeze/)
    expect(startAdmission).toHaveBeenCalledTimes(1)
  })

  it('keeps the clip when the changes only touch its words: no new take, nothing to pay for clips', async () => {
    const { projectsService, svc } = makeService()
    storeLoop()
    files.set(`p1/${BEAT_LOOP_QA_PATH}`, finishedQa())
    const changes = {
      caption: 'Still sweet',
      narration: 'Bees fan the nectar with their wings until it turns thick.',
      stamp: '3,000 years',
    }

    // redoFollowing too: with the clip kept, there is nothing after it to make again.
    const result = await svc.regenerateClip(
      'p1',
      'c2',
      { changes, redoFollowing: true },
      USER as never,
    )

    expect(result).toEqual({
      clipIds: [],
      clipRemade: false,
      clipUsd: beatLoopCost({ clips: 1, model: 'minimax-h3-max-turbo' }).clipUsd,
      estimatedCostUsd: 0,
      followingClipIds: [],
      projectId: 'p1',
      redoFollowing: false,
      storyboard: expect.objectContaining({ clips: expect.any(Array) }),
      workflowId: WORKFLOW_ID,
    })
    // Every clip stays kept: the run reuses them all, voices the lines again and renders.
    expect(files.get(`p1/${BEAT_LOOP_QA_PATH}`)).toEqual(finishedQa())
    const stored = files.get(`p1/${BEAT_LOOP_PATH}`) as { storyboard: BeatLoopStoryboard }
    expect(stored.storyboard.clips[1]).toEqual(expect.objectContaining({ ...changes, id: 'c2' }))
    // The result carries the storyboard as stored, so the chat's panel shows the new lines.
    expect(result.storyboard).toEqual(stored.storyboard)
    expect((startedArgs().storyboard as BeatLoopStoryboard).clips[1]).toEqual(
      expect.objectContaining(changes),
    )
    expect(projectsService.internalUpdateProject).toHaveBeenCalledWith(
      'p1',
      { script: expect.stringContaining(changes.narration) },
      USER.sub,
    )
  })

  it('quotes the clips an unfinished loop still makes when the changes only touch words', async () => {
    const { svc } = makeService()
    storeLoop()
    const qa = finishedQa()
    // The run stopped after c2: c3 and c4 were never made.
    qa.clips = qa.clips.slice(0, 2)
    files.set(`p1/${BEAT_LOOP_QA_PATH}`, qa)

    const result = await svc.regenerateClip(
      'p1',
      'c1',
      { changes: { stamp: 'c. 1300 BC' } },
      USER as never,
    )

    expect(result).toMatchObject({
      clipIds: ['c3', 'c4'],
      clipRemade: false,
      estimatedCostUsd: 2 * result.clipUsd,
    })
    expect(files.get(`p1/${BEAT_LOOP_QA_PATH}`)).toEqual(qa)
  })

  it('makes the clip again when the changes leave every slot as it was', async () => {
    const { svc } = makeService()
    storeLoop()
    files.set(`p1/${BEAT_LOOP_QA_PATH}`, finishedQa())
    const same = honeyStoryboard().clips[1]

    const result = await svc.regenerateClip(
      'p1',
      'c2',
      { changes: { hit: same.hit, stamp: same.stamp } },
      USER as never,
    )

    expect(result).toMatchObject({ clipIds: ['c2'], clipRemade: true })
    expect(qaClip('c2').generation).toBe(2)
  })

  it("refuses, changing nothing, when the take record can't be read (it is never read as empty)", async () => {
    const { svc } = makeService()
    storeLoop()
    files.set(`p1/${BEAT_LOOP_QA_PATH}`, CORRUPT)

    const redo = svc.regenerateClip('p1', 'c2', {}, USER as never)
    await expect(redo).rejects.toThrow(
      /long_take\/beat_loop_qa\.json can't be read: Unexpected end of JSON input/,
    )
    expect(files.get(`p1/${BEAT_LOOP_QA_PATH}`)).toBe(CORRUPT)
    expect(startAdmission).not.toHaveBeenCalled()
  })

  it("updates the project's script when a redo rewrites a line", async () => {
    const { projectsService, svc } = makeService()
    storeLoop()
    files.set(`p1/${BEAT_LOOP_QA_PATH}`, finishedQa())
    const narration = 'Bees fan the nectar with their wings until it turns thick.'

    await svc.regenerateClip('p1', 'c2', { changes: { narration } }, USER as never)

    expect(projectsService.internalUpdateProject).toHaveBeenCalledWith(
      'p1',
      { script: expect.stringContaining(`\n${narration}\n`) },
      USER.sub,
    )
  })

  it('refuses an unknown clip, naming the clips there are', async () => {
    const { svc } = makeService()
    storeLoop()
    files.set(`p1/${BEAT_LOOP_QA_PATH}`, finishedQa())
    await expect(svc.regenerateClip('p1', 'c9', {}, USER as never)).rejects.toThrow(
      'No clip c9. Clips: c1, c2, c3, c4.',
    )
  })

  it('refuses when the clip before has no last frame to start from yet', async () => {
    const { svc } = makeService()
    storeLoop()
    const qa = finishedQa()
    qa.clips = qa.clips.slice(0, 1)
    files.set(`p1/${BEAT_LOOP_QA_PATH}`, qa)

    const redo = svc.regenerateClip('p1', 'c3', {}, USER as never)
    await expect(redo).rejects.toBeInstanceOf(BadRequestException)
    await expect(redo).rejects.toThrow(/Clip c2 isn't made yet/)
    expect(files.get(`p1/${BEAT_LOOP_QA_PATH}`)).toEqual(qa)
    expect(startAdmission).not.toHaveBeenCalled()
  })

  it('refuses to redo a later clip while clip 1 still fails its checks (the loop stopped there)', async () => {
    const { svc } = makeService()
    storeLoop()
    const qa = finishedQa()
    qa.clips[0].flagged = true
    files.set(`p1/${BEAT_LOOP_QA_PATH}`, qa)

    await expect(svc.regenerateClip('p1', 'c2', {}, USER as never)).rejects.toThrow(
      'Clip c1 failed its checks, so the loop stopped there: redo clip c1 first.',
    )
    await expect(svc.regenerateClip('p1', 'c1', {}, USER as never)).resolves.toEqual(
      expect.objectContaining({ clipIds: ['c1'] }),
    )
  })

  it('refuses while the loop is being made, touching nothing', async () => {
    const { svc } = makeService()
    storeLoop()
    files.set(`p1/${BEAT_LOOP_QA_PATH}`, finishedQa())
    describeRun.mockResolvedValue({ status: { name: 'RUNNING' }, type: BEAT_LOOP_WORKFLOW_NAME })

    await expect(svc.regenerateClip('p1', 'c2', {}, USER as never)).rejects.toBeInstanceOf(
      ConflictException,
    )
    expect(files.get(`p1/${BEAT_LOOP_QA_PATH}`)).toEqual(finishedQa())
    expect(startAdmission).not.toHaveBeenCalled()
  })

  it('refuses two redos of one project at the same time', async () => {
    const { svc } = makeService()
    storeLoop()
    files.set(`p1/${BEAT_LOOP_QA_PATH}`, finishedQa())
    let release: () => void = () => undefined
    startAdmission.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ projectId: 'p1', workflowId: WORKFLOW_ID })
        }),
    )

    const first = svc.regenerateClip('p1', 'c2', {}, USER as never)
    await new Promise((r) => setImmediate(r))
    await expect(svc.regenerateClip('p1', 'c3', {}, USER as never)).rejects.toBeInstanceOf(
      ConflictException,
    )
    release()
    await expect(first).resolves.toEqual(expect.objectContaining({ clipIds: ['c2'] }))
  })
})

describe('BeatLoopService: a new picture as a keyframe', () => {
  const NEW = Buffer.from('the new picture')
  const clipUsd = () => beatLoopCost({ clips: 1, model: 'minimax-h3-max-turbo' }).clipUsd

  const uri = (name: string) => `store://p1/long_take/keyframes/${name}.png`
  const FRAMES = ['f0', 'f1', 'f2', 'f3']
  /** The loop's record of its frames (the keyframes step's), fN the copy of f0. */
  const frameRecord = () => ({
    complete: true,
    dialect: 'hailuo',
    frames: [
      ...FRAMES.map((id) => ({ id, prompt: `${id} prompt`, uri: uri(id) })),
      { copyOf: 'f0', id: 'f4', prompt: 'f0 prompt', uri: uri('f4') },
    ],
  })
  /** keyframes.json as the keyframes step writes it: what the page and the editor show. */
  const keyframesFile = () =>
    FRAMES.map((id) => ({ finalPrompt: `${id} prompt`, keyframeUrl: uri(id), shotId: id }))

  /** A finished loop: its storyboard, its kept clips, its five keyframe pictures and their
   *  record. */
  function storeFinishedLoop() {
    storeLoop()
    files.set(`p1/${BEAT_LOOP_QA_PATH}`, finishedQa())
    for (const id of ['f0', 'f1', 'f2', 'f3', 'f4'])
      files.set(`p1/long_take/keyframes/${id}.png`, Buffer.from(`old ${id}`))
    files.set('p1/long_take/beat_loop_keyframes.json', frameRecord())
    files.set('p1/long_take/keyframes.json', keyframesFile())
  }
  /** The stored keyframe pictures written under a new name, `<frame>-<stamp>.png`. */
  const stampedFrames = () =>
    [...files.keys()].filter((key) => /^p1\/long_take\/keyframes\/f\d-\w+\.png$/.test(key))

  it('plans a middle frame: the clip landing on it and every clip after it, each from the one before', async () => {
    const { svc } = makeService()
    storeFinishedLoop()

    await expect(svc.planKeyframeSwap('p1', 'f2')).resolves.toEqual({
      clipCount: 4,
      clipIds: ['c2', 'c3', 'c4'],
      clipUsd: clipUsd(),
      estimatedCostUsd: Math.round(3 * clipUsd() * 100) / 100,
      frameId: 'f2',
      framePaths: ['long_take/keyframes/f2.png'],
      modelLabel: 'MiniMax Hailuo 3 Max Turbo',
    })
    // Planning changes nothing.
    expect(qaClip('c2')).toEqual(finishedQa().clips[1])
    expect(files.get('p1/long_take/keyframes/f2.png')).toEqual(Buffer.from('old f2'))
    expect(startAdmission).not.toHaveBeenCalled()
  })

  it('plans f0 (and its closing copy) as every clip: the loop opens and lands on it', async () => {
    const { svc } = makeService()
    storeFinishedLoop()
    for (const frame of ['f0', 'f4']) {
      const plan = await svc.planKeyframeSwap('p1', frame)
      expect(plan).toMatchObject({
        clipIds: ['c1', 'c2', 'c3', 'c4'],
        frameId: 'f0',
        framePaths: ['long_take/keyframes/f0.png', 'long_take/keyframes/f4.png'],
      })
    }
    // f1 is where clip 1 lands: clip 1 and every clip after it, so all four too.
    expect((await svc.planKeyframeSwap('p1', 'f1')).clipIds).toEqual(['c1', 'c2', 'c3', 'c4'])
    expect((await svc.planKeyframeSwap('p1', 'f3')).clipIds).toEqual(['c3', 'c4'])
  })

  it('swaps the picture, keeps the old one on record, starts those clips over and runs the loop', async () => {
    const { svc } = makeService()
    storeFinishedLoop()

    const result = await svc.swapKeyframe('p1', 'f2', NEW, USER as never)

    expect(result).toMatchObject({ clipIds: ['c2', 'c3', 'c4'], workflowId: WORKFLOW_ID })
    expect(files.get('p1/long_take/keyframes/f2.png')).toEqual(NEW)
    const kept = [...files.keys()].filter((key) =>
      key.startsWith('p1/long_take/keyframes/replaced/'),
    )
    expect(kept).toEqual([
      expect.stringMatching(/^p1\/long_take\/keyframes\/replaced\/f2-\w+\.png$/),
    ])
    expect(files.get(kept[0])).toEqual(Buffer.from('old f2'))
    // The other frames, f0's closing copy included, stay as they are.
    for (const id of ['f0', 'f1', 'f3', 'f4'])
      expect(files.get(`p1/long_take/keyframes/${id}.png`)).toEqual(Buffer.from(`old ${id}`))
    // The clip landing on it and the clips after it start over; the clip before stays.
    expect(qaClip('c1')).toEqual(finishedQa().clips[0])
    for (const id of ['c2', 'c3', 'c4']) {
      expect(qaClip(id)).toEqual(expect.objectContaining({ generation: 2 }))
      expect(qaClip(id).keptTake).toBeUndefined()
      expect(qaClip(id).keepAfterRedo).toBeUndefined()
    }
    expect(startedArgs()).toEqual(expect.objectContaining({ projectId: 'p1', voiceId: 'voice-1' }))
  })

  it('points the page and the run at the new picture under a new name, so no old copy is shown', async () => {
    // The Storyboard panel and the editor show keyframes.json's picture: at the same address,
    // the browser would keep showing the old frame until a reload.
    const { svc } = makeService()
    storeFinishedLoop()

    await svc.swapKeyframe('p1', 'f2', NEW, USER as never)

    const stamped = stampedFrames()
    expect(stamped).toEqual([expect.stringMatching(/^p1\/long_take\/keyframes\/f2-\w+\.png$/)])
    expect(files.get(stamped[0])).toEqual(NEW)
    const newUri = `store://${stamped[0]}`
    expect(files.get('p1/long_take/keyframes.json')).toEqual(
      keyframesFile().map((k) => (k.shotId === 'f2' ? { ...k, keyframeUrl: newUri } : k)),
    )
    // The run reuses the frames on record (prompts unchanged) and makes clip 2 land on it.
    const record = frameRecord()
    expect(files.get('p1/long_take/beat_loop_keyframes.json')).toEqual({
      ...record,
      frames: record.frames.map((f) => (f.id === 'f2' ? { ...f, uri: newUri } : f)),
    })
  })

  it('a new f0 and its closing copy both get new names, on the page and on record', async () => {
    const { svc } = makeService()
    storeFinishedLoop()

    await svc.swapKeyframe('p1', 'f0', NEW, USER as never)

    const stamped = stampedFrames().sort()
    expect(stamped).toEqual([
      expect.stringMatching(/^p1\/long_take\/keyframes\/f0-\w+\.png$/),
      expect.stringMatching(/^p1\/long_take\/keyframes\/f4-\w+\.png$/),
    ])
    for (const key of stamped) expect(files.get(key)).toEqual(NEW)
    const [f0Uri, f4Uri] = stamped.map((key) => `store://${key}`)
    expect(
      (files.get('p1/long_take/keyframes.json') as { keyframeUrl: string }[])[0].keyframeUrl,
    ).toBe(f0Uri)
    const frames = (
      files.get('p1/long_take/beat_loop_keyframes.json') as ReturnType<typeof frameRecord>
    ).frames
    expect(frames.map((f) => f.uri)).toEqual([f0Uri, uri('f1'), uri('f2'), uri('f3'), f4Uri])
    expect(frames[4]).toMatchObject({ copyOf: 'f0', id: 'f4' })
  })

  it("refuses a frame missing from the loop's record: the run would draw it again over the new one", async () => {
    const { svc } = makeService()
    storeFinishedLoop()
    files.delete('p1/long_take/beat_loop_keyframes.json')
    await expect(svc.planKeyframeSwap('p1', 'f2')).rejects.toThrow(
      "Keyframe f2 isn't on the loop's record of its pictures",
    )
    const record = frameRecord()
    files.set('p1/long_take/beat_loop_keyframes.json', {
      ...record,
      frames: record.frames.filter((f) => f.id !== 'f2'),
    })
    await expect(svc.swapKeyframe('p1', 'f2', NEW, USER as never)).rejects.toThrow(
      "Keyframe f2 isn't on the loop's record of its pictures",
    )
    expect(files.get('p1/long_take/keyframes/f2.png')).toEqual(Buffer.from('old f2'))
    expect(startAdmission).not.toHaveBeenCalled()
  })

  it('a new f0 is written over its closing copy too, and every clip starts over', async () => {
    const { svc } = makeService()
    storeFinishedLoop()

    await svc.swapKeyframe('p1', 'f0', NEW, USER as never)

    expect(files.get('p1/long_take/keyframes/f0.png')).toEqual(NEW)
    expect(files.get('p1/long_take/keyframes/f4.png')).toEqual(NEW)
    for (const id of ['c1', 'c2', 'c3', 'c4'])
      expect(qaClip(id)).toEqual(expect.objectContaining({ generation: 2 }))
  })

  it('refuses an unknown frame, a frame not made yet, and a loop whose earlier clips are missing', async () => {
    const { svc } = makeService()
    storeFinishedLoop()
    await expect(svc.planKeyframeSwap('p1', 'f9')).rejects.toThrow(
      'No keyframe f9. The keyframes are f0, f1, f2, f3.',
    )
    files.delete('p1/long_take/keyframes/f3.png')
    await expect(svc.planKeyframeSwap('p1', 'f3')).rejects.toThrow("Keyframe f3 isn't made yet")
    files.set('p1/long_take/keyframes/f3.png', Buffer.from('old f3'))
    // Only clip 1 made: clip 3 (landing on f3) has no clip 2 to start from.
    const qa = finishedQa()
    qa.clips = qa.clips.slice(0, 1)
    files.set(`p1/${BEAT_LOOP_QA_PATH}`, qa)
    await expect(svc.planKeyframeSwap('p1', 'f3')).rejects.toThrow(
      "Clip c2 isn't made yet, so clip c3 has no frame to start from.",
    )
    // Clip 2 starts from clip 1's last frame: f2 can be swapped.
    expect((await svc.planKeyframeSwap('p1', 'f2')).clipIds).toEqual(['c2', 'c3', 'c4'])
  })

  it('refuses while the loop is being made, touching nothing', async () => {
    const { svc } = makeService()
    storeFinishedLoop()
    describeRun.mockResolvedValue({ status: { name: 'RUNNING' }, type: BEAT_LOOP_WORKFLOW_NAME })

    await expect(svc.swapKeyframe('p1', 'f2', NEW, USER as never)).rejects.toBeInstanceOf(
      ConflictException,
    )
    expect(files.get('p1/long_take/keyframes/f2.png')).toEqual(Buffer.from('old f2'))
    expect(qaClip('c2')).toEqual(finishedQa().clips[1])
    expect(startAdmission).not.toHaveBeenCalled()
  })
})

describe('BeatLoopService.isBeatLoopProject', () => {
  it('is true for a project made as a loop short', async () => {
    await expect(makeService().svc.isBeatLoopProject('p1')).resolves.toBe(true)
    await expect(
      makeService({ createUseCase: 'script-to-video' }).svc.isBeatLoopProject('p1'),
    ).resolves.toBe(false)
  })
})

describe('beatLoopEstimate', () => {
  const both = { FAL_KEY: 'x', GEMINI_API_KEY: 'y' }

  it("prices the loop model of the provider Setup picked: fal's H3, Google's Omni", () => {
    setGenerationProvider('fal')
    expect(beatLoopEstimate(6, { env: both })).toEqual(
      expect.objectContaining({
        ...beatLoopCost({ clips: 6, model: 'minimax-h3-max-turbo' }),
        provider: 'fal',
      }),
    )
    setGenerationProvider('google')
    expect(beatLoopEstimate(6, { env: both })).toEqual(
      expect.objectContaining({
        ...beatLoopCost({ clips: 6, model: 'omni-flash-google' }),
        provider: 'google',
      }),
    )
  })

  it("falls back to the other provider's loop model only when its key is set", () => {
    setGenerationProvider('fal')
    const registry: Pick<ModelRegistryFile, 'beatLoop' | 'models'> = {
      beatLoop: { video: ['omni-flash-google'] },
      models: modelRegistry().models,
    }
    const omni = beatLoopEstimate(4, { env: { GEMINI_API_KEY: 'y' }, registry })
    expect(omni.provider).toBe('google')
    expect(omni.model).toBe('omni-flash-google')
    // Priced on Google, not swapped for fal's clip model.
    expect(omni.clipUsd).toBeGreaterThan(beatLoopEstimate(4, { env: both }).clipUsd)

    expect(() => beatLoopEstimate(4, { env: {}, registry })).toThrow(/No model can make loop clips/)
  })
})
