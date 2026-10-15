import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { BadRequestException } from '@nestjs/common'
import type { AgentQuestion } from '@shared/types/api/agent'
import sharp from 'sharp'

import type { KeyframeSwapPlan } from '../../long-take/long-take-keyframe-swap.util'

import { AgentEditService } from './agent-edit.service'

const STORY_PLAN: KeyframeSwapPlan = {
  clipCount: 7,
  clips: [
    { endMs: 5400, id: 'transition_0', lands: true, number: 1, startMs: 0, usd: 0.24 },
    { endMs: 8720, id: 'transition_1', lands: false, number: 2, startMs: 5400, usd: 0.2 },
  ],
  frame: { height: 1360, width: 768 },
  loop: false,
  modelLabel: 'MiniMax Hailuo 3 Max Turbo',
  shotId: '2',
  totalUsd: 0.44,
}

const LOOP_PLAN: KeyframeSwapPlan = {
  clipCount: 6,
  clips: [3, 4, 5, 6].map((n) => ({
    endMs: n * 4000,
    id: `s${n}`,
    lands: n === 3,
    number: n,
    startMs: (n - 1) * 4000,
    usd: 0.16,
  })),
  frame: { height: 1344, width: 768 },
  loop: true,
  modelLabel: 'MiniMax Hailuo 3 Max Turbo',
  shotId: 'f3',
  totalUsd: 0.64,
}

const CLIP_RUN = 'ao:p1:story-mode:transition-keyframe-regen:2'
const RENDER_RUN = 'ao:p1:story-mode:render'
const LOOP_RUN = 'ao:p1:story-mode'
const STAGED = {
  keyframeUri: 'store://projects/p1/long_take/keyframes/2-x.png',
  picturePath: 'long_take/keyframes/2-x.png',
  thumbnailUri: 'store://projects/p1/long_take/keyframes/thumbnails/2-x.webp',
}

/** A card the tool put up: its question, and the user's answer or the card going away. */
interface Card {
  answer: (answers: Record<string, string[]>) => void
  expire: (error: Error) => void
  questionId: string
  questions: AgentQuestion[]
}

let dir: string
beforeEach(async () => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kf-edit-')))
  fs.mkdirSync(path.join(dir, 'frames'))
  // What Codex's image tool made from keyframe 2: a fixed hand, a little bigger than the frame.
  const picture = (width: number, height: number) =>
    sharp({ create: { background: '#999', channels: 3, height, width } })
      .png()
      .toFile(path.join(dir, 'frames', `${width}x${height}.png`))
  await Promise.all([picture(943, 1668), picture(1024, 1024)])
})
afterEach(() => fs.rmSync(dir, { force: true, recursive: true }))

function makeEdit(
  over: {
    plan?: KeyframeSwapPlan
    planError?: Error
    status?: { stage: string; videoUrl: null | string }
    waits?: Record<string, unknown>
  } = {},
) {
  const plan = over.plan ?? STORY_PLAN
  const cards: Card[] = []
  const session = { editing: true, id: 's1', mode: 'autonomous', projectId: 'p1', status: 'idle' }
  const sessions = {
    askServerQuestion: jest.fn(
      (_id: string, questionId: string, questions: AgentQuestion[]) =>
        new Promise((resolve, reject) =>
          cards.push({ answer: resolve, expire: reject, questionId, questions }),
        ),
    ),
    beginEditing: jest.fn(),
    clearFlowCancelled: jest.fn(),
    emitAutonomousEvent: jest.fn(),
    emitNotice: jest.fn(),
    expireServerQuestion: jest.fn((_id: string, questionId: string) =>
      cards.find((c) => c.questionId === questionId)?.expire(new Error('replaced')),
    ),
    getSession: jest.fn(() => session),
    isFlowCancelled: jest.fn(() => false),
    linkProject: jest.fn(),
    notifyAgent: jest.fn(),
    sessionDir: jest.fn(() => dir),
    setFlowWorking: jest.fn(),
    workingDir: jest.fn(() => dir),
  }
  const calls: string[] = []
  const longTake = {
    commitKeyframe: jest.fn(async () => {
      calls.push('commitKeyframe')
    }),
    // The clips as the run left them: the two made again under new names, the third as it was.
    getStateWithUnrenderedChanges: jest.fn(async () => ({
      data: {
        keyframes: [],
        transitions: ['transition_0-rx', 'transition_1-rx', 'transition_2'].map((name) => ({
          transitionId: name.replace(/-rx$/, ''),
          videoUri: `http://localhost:5017/api/files/projects/p1/long_take/transitions/${name}.mp4`,
        })),
      },
    })),
    getStatus: jest.fn(async () => over.status ?? { stage: 'completed', videoUrl: 'http://v' }),
    isBeatLoopProject: jest.fn(async () => plan.loop),
    planKeyframeSwap: jest.fn(async () => {
      if (over.planError) throw over.planError
      return plan
    }),
    remakeClipsWithKeyframe: jest.fn(async () => {
      calls.push('remakeClipsWithKeyframe')
      return { ...STAGED, transitionIds: ['transition_0', 'transition_1'], workflowId: CLIP_RUN }
    }),
    renderFromState: jest.fn(async () => {
      calls.push('renderFromState')
      return { workflowId: RENDER_RUN }
    }),
    swapLoopKeyframe: jest.fn(async () => {
      calls.push('swapLoopKeyframe')
      return { clipIds: ['s3', 's4', 's5', 's6'], workflowId: LOOP_RUN }
    }),
  }
  const cancelled: string[] = []
  const waitForWorkflow = jest.fn(async (id: string, _timeoutMs: number) => {
    calls.push(`wait ${id}`)
    return over.waits && id in over.waits ? over.waits[id] : {}
  })
  const svc = new AgentEditService({
    autonomous: {} as never,
    cancelWorkflow: async (id) => {
      cancelled.push(id)
    },
    longTake: longTake as never,
    pictureRoots: () => [dir],
    projects: { getProject: jest.fn(async () => ({ id: 'p1' })) } as never,
    sessions: sessions as never,
    user: () => ({ sub: 'u', userId: 'u' }) as never,
    waitForWorkflow,
  })
  return { calls, cancelled, cards, longTake, sessions, svc, waitForWorkflow }
}

/** Waits for the detached work a card's answer starts (it polls its runs every half second). */
async function eventually(check: () => boolean, ms = 8000): Promise<void> {
  const until = Date.now() + ms
  while (!check()) {
    if (Date.now() > until) throw new Error('Timed out waiting')
    await new Promise((r) => setTimeout(r, 20))
  }
}

const use = (t: ReturnType<typeof makeEdit>, args: Record<string, unknown>) =>
  t.svc.callTool('s1', 'use_image_as_keyframe', args)
const FIXED = { image: 'frames/943x1668.png', keyframe: '2' }

describe('use_image_as_keyframe: the card', () => {
  it('shows the clips and the cost on a card, and makes nothing until it is answered', async () => {
    const t = makeEdit()

    const r = await use(t, { ...FIXED, keyframe: 2 })

    expect(r.success).toBe(true)
    expect(JSON.parse(r.text)).toEqual({
      clips: [
        { clip: 1, id: 'transition_0', seconds: '0-5.4', usd: 0.24 },
        { clip: 2, id: 'transition_1', seconds: '5.4-8.7', usd: 0.2 },
      ],
      estimatedCostUsd: 0.44,
      keyframe: '2',
      model: 'MiniMax Hailuo 3 Max Turbo',
      next: expect.stringContaining('"Make it"'),
      picture: "Fitted to the keyframe's 768x1360.",
      status: 'waiting_for_make_it',
    })
    expect(t.longTake.planKeyframeSwap).toHaveBeenCalledWith('p1', '2')
    expect(t.cards).toHaveLength(1)
    expect(t.cards[0].questionId).toMatch(/^keyframe-[\w-]+$/)
    const [question] = t.cards[0].questions
    expect(question).toMatchObject({
      header: 'New picture',
      isOther: false,
      question: 'Put the new picture in the video? About $0.44',
    })
    expect(question.options.map((o) => o.label)).toEqual(['Make it', 'Not now'])
    expect(question.options[0].description).toBe(
      'It becomes keyframe 2, where clip 1 ends and clip 2 begins. Clips 1 and 2 (0-8.7 s) are made again from it on MiniMax Hailuo 3 Max Turbo, with the same moves, then the video is rebuilt.',
    )
    expect(question.options[1].description).toBe('Nothing is changed or spent.')
    // Nothing paid for, however long the card stays open.
    await new Promise((r) => setTimeout(r, 50))
    expect(t.calls).toEqual([])
  })

  it('Not now changes nothing, and says so in the chat', async () => {
    const t = makeEdit()
    await use(t, FIXED)
    t.cards[0].answer({ use: ['Not now'] })
    await eventually(() => t.sessions.emitNotice.mock.calls.length > 0)
    expect(t.sessions.emitNotice).toHaveBeenCalledWith('s1', 'The keyframe was not changed.')
    expect(t.calls).toEqual([])
  })

  it('a second call replaces the card: the old one expires, and the new one has the new picture', async () => {
    const t = makeEdit()
    await use(t, FIXED)
    await use(t, FIXED)
    expect(t.sessions.expireServerQuestion).toHaveBeenCalledWith('s1', t.cards[0].questionId)
    expect(t.cards[1].questionId).not.toBe(t.cards[0].questionId)
    t.cards[1].answer({ use: ['Make it'] })
    await eventually(() => t.sessions.notifyAgent.mock.calls.length > 0)
    expect(t.longTake.remakeClipsWithKeyframe).toHaveBeenCalledTimes(1)
  })

  it('Stop while the card is open: it expires, nothing is made, and a new card can follow', async () => {
    const t = makeEdit()
    await use(t, FIXED)
    t.cards[0].expire(new Error('Stopped'))
    await new Promise((r) => setTimeout(r, 20))
    expect(t.calls).toEqual([])
    expect((await use(t, FIXED)).success).toBe(true)
    expect(t.sessions.expireServerQuestion).not.toHaveBeenCalled()
  })
})

describe('use_image_as_keyframe: refusals (no card)', () => {
  it('refuses a picture outside the chat and the project, a missing one, and no picture', async () => {
    const t = makeEdit()
    for (const image of ['/etc/hosts.png', 'frames/missing.png', '../outside.png']) {
      const r = await use(t, { image, keyframe: '2' })
      expect(r.success).toBe(false)
      expect(r.text).toContain(`Can't use ${image}`)
    }
    expect(await use(t, { keyframe: '2' })).toMatchObject({ success: false })
    expect(await use(t, { image: FIXED.image })).toMatchObject({ success: false })
    expect(t.sessions.askServerQuestion).not.toHaveBeenCalled()
  })

  it('refuses a picture of another shape, naming both shapes', async () => {
    const t = makeEdit()
    const r = await use(t, { image: 'frames/1024x1024.png', keyframe: '2' })
    expect(r.success).toBe(false)
    expect(r.text).toContain('1024x1024 (1:1)')
    expect(r.text).toContain('768x1360 (9:16)')
    expect(t.sessions.askServerQuestion).not.toHaveBeenCalled()
  })

  it("answers the plan's refusal as text: an unknown keyframe, a loop still being made", async () => {
    const t = makeEdit({
      planError: new BadRequestException('No keyframe 9. The keyframes are 1, 2, 3.'),
    })
    expect(await use(t, { ...FIXED, keyframe: '9' })).toEqual({
      success: false,
      text: 'No keyframe 9. The keyframes are 1, 2, 3.',
    })
    expect(t.sessions.askServerQuestion).not.toHaveBeenCalled()
  })

  it('needs a finished story video', async () => {
    const t = makeEdit({ status: { stage: 'transitions', videoUrl: null } })
    expect(await use(t, FIXED)).toEqual({ success: false, text: 'No finished video yet.' })
  })
})

describe('use_image_as_keyframe: after Make it', () => {
  it('makes the clips from the new picture, makes it the keyframe, then rebuilds the video', async () => {
    const t = makeEdit()
    await use(t, FIXED)
    t.cards[0].answer({ use: ['Make it'] })
    await eventually(() => t.sessions.notifyAgent.mock.calls.length > 0)

    expect(t.calls).toEqual([
      'remakeClipsWithKeyframe',
      `wait ${CLIP_RUN}`,
      'commitKeyframe',
      'renderFromState',
      `wait ${RENDER_RUN}`,
    ])
    const [projectId, shotId, png] = t.longTake.remakeClipsWithKeyframe.mock
      .calls[0] as unknown as [string, string, Buffer]
    expect([projectId, shotId]).toEqual(['p1', '2'])
    // The picture as fitted to the keyframe: a PNG of its exact size.
    expect(await sharp(png).metadata()).toMatchObject({ format: 'png', height: 1360, width: 768 })
    expect(t.longTake.commitKeyframe).toHaveBeenCalledWith(
      'p1',
      '2',
      expect.objectContaining(STAGED),
    )
    expect(t.sessions.emitAutonomousEvent).toHaveBeenCalledWith('s1', {
      projectId: 'p1',
      type: 'video_rendered',
    })
    const [[, note]] = t.sessions.notifyAgent.mock.calls as unknown as [string, string][]
    expect(note).toContain('not shown to the user')
    expect(note).toContain('keyframe 2')
    expect(note).toContain('Clips 1 and 2')
    expect(note).toContain('rebuilt')
    // Where to look: the new picture under the keyframe's own name, and the new clips' files,
    // not the old clip files a check or a second fix would otherwise start from.
    expect(note).toContain('project/long_take/keyframes/2.png')
    expect(note).toContain('project/long_take/transitions/transition_0-rx.mp4')
    expect(note).toContain('project/long_take/transitions/transition_1-rx.mp4')
    expect(note).not.toContain('transition_2')
    expect(t.sessions.setFlowWorking.mock.calls).toEqual([
      ['s1', true],
      ['s1', false],
    ])
    expect(t.sessions.clearFlowCancelled).toHaveBeenCalledWith('s1')
  })

  it('a failed clip run reaches the chat and the agent, and changes nothing', async () => {
    const t = makeEdit({ waits: { [CLIP_RUN]: Promise.reject(new Error('fal said 500')) } })
    await use(t, FIXED)
    t.cards[0].answer({ use: ['Make it'] })
    await eventually(() => t.sessions.notifyAgent.mock.calls.length > 0)

    expect(t.longTake.commitKeyframe).not.toHaveBeenCalled()
    expect(t.longTake.renderFromState).not.toHaveBeenCalled()
    const [[, notice]] = t.sessions.emitNotice.mock.calls as unknown as [string, string][]
    expect(notice).toContain('fal said 500')
    expect(notice).toContain("The video wasn't changed.")
    const [[, note]] = t.sessions.notifyAgent.mock.calls as unknown as [string, string][]
    expect(note).toContain('fal said 500')
    expect(note).toContain("the video wasn't changed")
    expect(note).toContain('use_image_as_keyframe')
    expect(t.sessions.emitAutonomousEvent).not.toHaveBeenCalled()
    expect(t.sessions.setFlowWorking).toHaveBeenLastCalledWith('s1', false)
  })

  it('a failed rebuild says the picture and the clips are in, and how to rebuild', async () => {
    const t = makeEdit({ waits: { [RENDER_RUN]: Promise.reject(new Error('ffmpeg crashed')) } })
    await use(t, FIXED)
    t.cards[0].answer({ use: ['Make it'] })
    await eventually(() => t.sessions.notifyAgent.mock.calls.length > 0)

    expect(t.longTake.commitKeyframe).toHaveBeenCalled()
    const [[, notice]] = t.sessions.emitNotice.mock.calls as unknown as [string, string][]
    expect(notice).toContain('ffmpeg crashed')
    const [[, note]] = t.sessions.notifyAgent.mock.calls as unknown as [string, string][]
    expect(note).toContain('render_video')
  })

  it('Stop during the clip run cancels it; nothing in the video changed', async () => {
    const t = makeEdit({ waits: { [CLIP_RUN]: new Promise(() => undefined) } })
    await use(t, FIXED)
    t.cards[0].answer({ use: ['Make it'] })
    await eventually(() => t.calls.includes(`wait ${CLIP_RUN}`))
    t.sessions.isFlowCancelled.mockReturnValue(true)
    await eventually(() => t.sessions.emitNotice.mock.calls.length > 0)
    expect(t.cancelled).toEqual([CLIP_RUN])
    expect(t.sessions.emitNotice).toHaveBeenCalledWith('s1', "Stopped: the video wasn't changed.")
    expect(t.longTake.commitKeyframe).not.toHaveBeenCalled()
  })

  it('refuses other edits while it runs, and frees the project after', async () => {
    let finish: (value: unknown) => void = (_value) => undefined
    const t = makeEdit({ waits: { [CLIP_RUN]: new Promise((r) => (finish = r)) } })
    await use(t, FIXED)
    t.cards[0].answer({ use: ['Make it'] })
    await eventually(() => t.calls.includes(`wait ${CLIP_RUN}`))
    expect(await t.svc.callTool('s1', 'render_video', {})).toMatchObject({ success: false })
    expect(await use(t, FIXED)).toMatchObject({ success: false })
    finish({})
    await eventually(() => t.sessions.notifyAgent.mock.calls.length > 0)
    expect((await use(t, FIXED)).success).toBe(true)
  })
})

describe('use_image_as_keyframe on a loop short', () => {
  it("lists the clip landing on the frame and every clip after it, then runs the loop's own swap", async () => {
    const t = makeEdit({ plan: LOOP_PLAN })
    const r = await use(t, { image: FIXED.image, keyframe: 'f3' })
    expect(JSON.parse(r.text)).toMatchObject({
      clips: [3, 4, 5, 6].map((n) => expect.objectContaining({ clip: n, id: `s${n}` })),
      estimatedCostUsd: 0.64,
      keyframe: 'f3',
    })
    const [question] = t.cards[0].questions
    expect(question.question).toBe('Put the new picture in the video? About $0.64')
    expect(question.options[0].description).toBe(
      'It becomes the picture clip 3 lands on. Clips 3 to 6 (8-24 s) are made again from it on MiniMax Hailuo 3 Max Turbo, with the same moves, each from the clip before, then the loop is rebuilt.',
    )

    t.cards[0].answer({ use: ['Make it'] })
    await eventually(() => t.sessions.notifyAgent.mock.calls.length > 0)
    expect(t.calls).toEqual(['swapLoopKeyframe', `wait ${LOOP_RUN}`])
    const [, shotId, png] = t.longTake.swapLoopKeyframe.mock.calls[0] as unknown as [
      string,
      string,
      Buffer,
    ]
    expect(shotId).toBe('f3')
    expect(await sharp(png).metadata()).toMatchObject({ height: 1344, width: 768 })
    // Four clips: the wait allows for each of them.
    expect(t.waitForWorkflow.mock.calls[0][1]).toBeGreaterThan(10 * 60 * 1000 + 3 * 5 * 60 * 1000)
    expect(t.longTake.renderFromState).not.toHaveBeenCalled()
    expect(t.sessions.emitAutonomousEvent).toHaveBeenCalledWith('s1', {
      projectId: 'p1',
      type: 'video_rendered',
    })
    const [[, note]] = t.sessions.notifyAgent.mock.calls as unknown as [string, string][]
    expect(note).toContain('Clips 3 to 6')
    expect(note).toContain('project/long_take/keyframes/f3.png')
    expect(note).toContain('project/final_video.mp4')
  })

  it("f0: the loop's first picture, which it begins and ends on", async () => {
    const all = [1, 2, 3, 4, 5, 6].map((n) => ({
      endMs: n * 4000,
      id: `s${n}`,
      lands: n === 6,
      number: n,
      startMs: (n - 1) * 4000,
      usd: 0.16,
    }))
    const t = makeEdit({ plan: { ...LOOP_PLAN, clips: all, shotId: 'f0', totalUsd: 0.96 } })
    await use(t, { image: FIXED.image, keyframe: 'f0' })
    expect(t.cards[0].questions[0].options[0].description).toMatch(
      /^It becomes the loop's first picture, which it begins and ends on\./,
    )
  })

  it('a failed loop run reaches the chat and the agent, with how to finish it', async () => {
    const t = makeEdit({
      plan: LOOP_PLAN,
      waits: { [LOOP_RUN]: Promise.reject(new Error('H3 timed out')) },
    })
    await use(t, { image: FIXED.image, keyframe: 'f3' })
    t.cards[0].answer({ use: ['Make it'] })
    await eventually(() => t.sessions.notifyAgent.mock.calls.length > 0)
    const [[, notice]] = t.sessions.emitNotice.mock.calls as unknown as [string, string][]
    expect(notice).toContain('H3 timed out')
    const [[, note]] = t.sessions.notifyAgent.mock.calls as unknown as [string, string][]
    expect(note).toContain('H3 timed out')
    // How to finish it without paying again for the clips the run did make.
    expect(note).toContain('regenerate_clip with no changes on the first of s3, s4, s5, s6')
  })
})
