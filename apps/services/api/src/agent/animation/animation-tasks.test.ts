import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { AgentAnimationSetupView, AgentSession } from '@shared/types/api/agent'

import { MotionTaskTracker, type MotionToolCall, readReelFacts } from '../motion-reel/motion-tasks'

import { type AnimationTaskInput, animationTasks } from './animation-tasks'

const SETUP: AgentAnimationSetupView = {
  lengthSec: 30,
  lookId: '2d',
  lookLabel: '2D',
  music: { engine: 'composer', source: 'agent' },
  musicTitle: null,
  subject: 'Why clouds float',
}

const call = (tool: string, ok?: boolean, text?: string, startedAt = 1000): MotionToolCall => ({
  ...(ok === undefined ? {} : { endedAt: startedAt + 10, ok, text }),
  startedAt,
  tool,
})

const NO_FACTS = {
  musicChangedAt: 0,
  musicScore: false,
  plan: null,
  scenes: { lastChange: 0, names: [] },
}

const input = (over: Partial<AnimationTaskInput> = {}): AnimationTaskInput => ({
  calls: [],
  facts: NO_FACTS,
  mode: 'animation',
  setup: SETUP,
  working: false,
  ...over,
})

const row = (tasks: ReturnType<typeof animationTasks>, id: string) => tasks.find((t) => t.id === id)

describe('animationTasks', () => {
  it("lists an animation's own phases, in order", () => {
    expect(animationTasks(input()).map((t) => [t.id, t.label])).toEqual([
      ['setup', 'Set up'],
      ['plan', 'Plan'],
      ['voice', 'Voices'],
      ['music', 'Music'],
      ['build', 'Build'],
      ['look', 'Look (stills)'],
      ['render', 'Render'],
      ['review', 'Review'],
    ])
  })

  it('waits for the card before anything is set up', () => {
    const tasks = animationTasks(input({ setup: undefined }))
    expect(row(tasks, 'setup')).toMatchObject({
      result: 'Waiting for the setup card',
      state: 'waiting',
    })
  })

  it('shows the setup, the plan and the voices as they get done', () => {
    const tasks = animationTasks(
      input({
        calls: [
          call(
            'animation_voice',
            true,
            'Recorded 6 lines (Drip, Cloud): 31.2 s in all, saved as public/voice.wav.\nLine 3 ("Then why") may have a clipped or misheard word: listen to it.',
          ),
        ],
        facts: { ...NO_FACTS, plan: { scenes: 6, sections: 2 } },
      }),
    )
    expect(row(tasks, 'setup')).toMatchObject({ result: '2D, about 30 s', state: 'done' })
    expect(row(tasks, 'plan')).toMatchObject({
      result: 'plan.md: 2 sections, 6 scenes',
      state: 'done',
    })
    expect(row(tasks, 'voice')).toMatchObject({
      details: ['Line 3 ("Then why") may have a clipped or misheard word: listen to it.'],
      result: 'Recorded 6 lines (Drip, Cloud): 31.2 s in all',
      state: 'done',
    })
  })

  it('shows music being composed, then its title', () => {
    const composing = animationTasks(
      input({ facts: { ...NO_FACTS, musicChangedAt: 5000, musicScore: true }, working: true }),
    )
    expect(row(composing, 'music')).toMatchObject({ state: 'running' })
    const made = animationTasks(
      input({ setup: { ...SETUP, musicTitle: 'Composed: C major, 96 BPM' } }),
    )
    expect(row(made, 'music')).toMatchObject({ result: 'Composed: C major, 96 BPM', state: 'done' })
    const none = animationTasks(input({ setup: { ...SETUP, music: { source: 'none' } } }))
    expect(row(none, 'music')).toMatchObject({ result: 'No music', state: 'done' })
  })

  it('counts stills and renders, and says why a render failed', () => {
    const tasks = animationTasks(
      input({
        calls: [
          call(
            'animation_still',
            true,
            'Rendered 2 stills (the user sees them too). Open each file and look at it:\n- 0 s (frame 0): animation/out/stills/1/frame-0.png\n- 12.5 s (frame 375): animation/out/stills/1/frame-375.png',
          ),
          call('animation_render', false, 'It failed:\nChrome crashed', 2000),
        ],
      }),
    )
    expect(row(tasks, 'look')).toMatchObject({
      details: ['0 s', '12.5 s'],
      result: '2 stills over 1 look',
      state: 'done',
    })
    expect(row(tasks, 'render')).toMatchObject({
      result: 'It failed: Chrome crashed',
      state: 'failed',
    })
  })
})

describe('the Avatar row', () => {
  const head = (avatar: AgentAnimationSetupView['avatar'], over = {}) =>
    animationTasks(
      input({ setup: { ...SETUP, avatar, lookId: 'avatar', lookLabel: 'Talking head', ...over } }),
    )

  it('shows only for a Talking head, after Set up', () => {
    expect(animationTasks(input()).some((t) => t.id === 'avatar')).toBe(false)
    expect(
      head({ id: 'av-0123456789' })
        .map((t) => t.id)
        .slice(0, 3),
    ).toEqual(['setup', 'avatar', 'plan'])
  })

  it('is done for a saved avatar, and waits for a new one until it is saved', () => {
    expect(row(head({ id: 'av-0123456789' }, { avatarName: 'Sam' }), 'avatar')).toMatchObject({
      result: 'Sam',
      state: 'done',
    })
    expect(row(head({ name: 'Ana', photo: 'me.jpg', style: '2d' }), 'avatar')).toMatchObject({
      result: 'Drawing Ana from the photo',
      state: 'waiting',
    })
    const checking = animationTasks(
      input({
        calls: [call('avatar_check', true, 'Rendered the sheet')],
        setup: {
          ...SETUP,
          avatar: { name: 'Ana', photo: 'me.jpg', style: '2d' },
          lookId: 'avatar',
        },
      }),
    )
    expect(row(checking, 'avatar')).toMatchObject({ state: 'running' })
  })
})

describe('the Review row', () => {
  const SHEETS = 'Made 2 contact sheets of the render (the user sees them too): …'
  it('waits for a check after each render, and shows the round and review.md', () => {
    const rendered = animationTasks(
      input({ calls: [call('animation_render', true, 'Rendered', 1000)] }),
    )
    expect(row(rendered, 'review')).toMatchObject({
      result: 'Render 1 not reviewed yet',
      state: 'waiting',
    })
    const checked = animationTasks(
      input({
        calls: [
          call('animation_render', true, 'Rendered', 1000),
          call('animation_review', true, SHEETS, 2000),
        ],
        facts: { ...NO_FACTS, review: { firstLine: 'Review', problems: 3 } },
      }),
    )
    expect(row(checked, 'review')).toMatchObject({
      result: '2 sheets, round 1 · review.md: 3 problems',
      state: 'done',
    })
    const again = animationTasks(
      input({
        calls: [
          call('animation_render', true, 'Rendered', 1000),
          call('animation_review', true, SHEETS, 2000),
          call('animation_render', true, 'Rendered', 3000),
        ],
      }),
    )
    expect(row(again, 'review')).toMatchObject({ state: 'waiting' })
    expect(row(again, 'review')?.result).toMatch(/render 2 not reviewed yet/)
  })
})

describe('MotionTaskTracker, an animation chat', () => {
  it("sends an animation's phases and its plan from animation/", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'animation-tasks-'))
    fs.mkdirSync(path.join(workspace, 'animation'), { recursive: true })
    fs.writeFileSync(path.join(workspace, 'animation', 'plan.md'), '# Plan\n\n- Scene 1: hook\n')
    const events: unknown[] = []
    const session = {
      animation: SETUP,
      id: 's1',
      mode: 'animation',
      status: 'idle',
    } as AgentSession
    const tracker = new MotionTaskTracker({
      emitAutonomousEvent: (_id, e) => events.push(e),
      getSession: () => session,
      workingDir: () => workspace,
    })
    await tracker.track('s1', 'animation_voice', async () => ({
      success: true,
      text: 'Recorded 1 lines (Drip): 2 s in all.',
    }))
    const last = events.at(-1) as {
      plan: { text: string }
      tasks: { id: string; state: string }[]
    }
    expect(last.tasks.map((t) => t.id)).toContain('voice')
    expect(last.tasks.find((t) => t.id === 'voice')?.state).toBe('done')
    const withPlan = events.find((e) => (e as { plan?: unknown }).plan) as {
      plan: { text: string }
    }
    expect(withPlan.plan.text).toContain('Scene 1: hook')
    expect(readReelFacts(path.join(workspace, 'animation')).plan).toEqual({
      scenes: 1,
      sections: 0,
    })
  })
})
