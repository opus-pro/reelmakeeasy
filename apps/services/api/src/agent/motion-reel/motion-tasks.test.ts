import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type {
  AgentMotionPlan,
  AgentMotionSetupView,
  AgentMotionTask,
  AgentSession,
} from '@shared/types/api/agent'

import {
  MAX_PLAN_TEXT_BYTES,
  type MotionTaskInput,
  motionTasks,
  MotionTaskTracker,
  type MotionToolCall,
  readPlanText,
  readReelFacts,
} from './motion-tasks'

const SETUP: AgentMotionSetupView = {
  bars: 8,
  bpm: 128,
  lengthSec: 15,
  music: { engine: 'eleven-music', source: 'agent' },
  musicTitle: null,
  ratio: '16:9',
  reelSec: 15,
  type: 'showreel',
  typeLabel: 'Motion reel',
  subject: 'A reel',
} as AgentMotionSetupView

const RENDER_FAIL = [
  'Rendered the reel (15 s, 8 bars at 128 BPM) and showed it to the user. The file is reel/out/reel.mp4.',
  '',
  'Sync check (the picture against the music):',
  'Cuts: 6 of 7 on the grid.',
  'Kick pulse: none.',
  'Sync: 2 to fix: kick pulse, section starts.',
  '',
  'Fix every miss listed above at the beats it names, then render again.',
].join('\n')

const RENDER_PASS = [
  'Rendered the reel (15 s, 8 bars at 128 BPM) and showed it to the user. The file is reel/out/reel.mp4.',
  '',
  'Sync check (the picture against the music):',
  'Cuts: 7 of 7 on the grid.',
  'Sync: passes.',
].join('\n')

const STILLS = [
  'Rendered 2 stills (the user sees them too). Open each file and look at it:',
  '- beat 4 (frame 113): reel/out/stills/1/frame-113.png',
  '- beat 12 (frame 338): reel/out/stills/1/frame-338.png',
].join('\n')

const call = (tool: string, ok?: boolean, text?: string, startedAt = 1000): MotionToolCall => ({
  ...(ok === undefined ? {} : { endedAt: startedAt + 1, ok, text: text ?? '' }),
  startedAt,
  tool,
})

const noFacts = {
  musicChangedAt: 0,
  musicScore: false,
  plan: null,
  review: null,
  scenes: { lastChange: 0, names: [] },
}

function reelDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-tasks-'))
  return path.join(dir, 'reel')
}

function tasks(
  input: Partial<MotionTaskInput>,
): Record<string, Omit<AgentMotionTask, 'id' | 'label'>> {
  const list = motionTasks({
    calls: [],
    facts: noFacts,
    mode: 'motion',
    setup: undefined,
    working: false,
    ...input,
  })
  return Object.fromEntries(list.map(({ id, label: _label, ...rest }) => [id, rest]))
}

describe('motionTasks', () => {
  it('lists the eight phases in order, all waiting before the setup', () => {
    const list = motionTasks({
      calls: [],
      facts: noFacts,
      mode: 'motion',
      setup: undefined,
      working: false,
    })
    expect(list.map((t) => [t.id, t.label, t.state])).toEqual([
      ['setup', 'Set up', 'waiting'],
      ['music', 'Music', 'waiting'],
      ['plan', 'Plan', 'waiting'],
      ['build', 'Build', 'waiting'],
      ['look', 'Look (stills)', 'waiting'],
      ['render', 'Render', 'waiting'],
      ['sync', 'Sync check', 'waiting'],
      ['review', 'Review', 'waiting'],
    ])
    expect(list[0]?.result).toBe('Waiting for the setup card')
  })

  it("an Advanced chat's motion_setup: running while it runs, failed with its reason", () => {
    expect(tasks({ calls: [call('motion_setup')], mode: 'motion_free' }).setup).toEqual({
      result: 'Setting up the reel…',
      state: 'running',
    })
    expect(
      tasks({ calls: [call('motion_setup', false, 'That style is unknown.\nmore')] }).setup,
    ).toEqual({ details: ['more'], result: 'That style is unknown.', state: 'failed' })
    expect(tasks({ setup: SETUP }).setup).toEqual({
      result: 'Motion reel, 16:9, 15 s (8 bars at 128 BPM)',
      state: 'done',
    })
  })

  it('music: a library track is done; music the agent makes follows motion_music', () => {
    const library = {
      ...SETUP,
      music: { id: 'pulse-drive', source: 'library' as const },
      musicTitle: 'Pulse Drive',
    }
    expect(tasks({ setup: library }).music).toEqual({
      result: 'Pulse Drive, 128 BPM',
      state: 'done',
    })
    expect(tasks({ setup: { ...SETUP, music: { source: 'none' } } }).music.result).toBe('No music')
    expect(tasks({ setup: SETUP }).music).toEqual({ result: null, state: 'waiting' })
    expect(tasks({ facts: { ...noFacts, musicScore: true }, setup: SETUP }).music.result).toMatch(
      /Score written/,
    )
    expect(tasks({ calls: [call('motion_music')], setup: SETUP }).music.state).toBe('running')
    expect(
      tasks({ calls: [call('motion_music', false, 'No score.wav yet.')], setup: SETUP }).music,
    ).toEqual({ result: 'No score.wav yet.', state: 'failed' })
    expect(
      tasks({
        calls: [call('motion_music', true)],
        setup: { ...SETUP, bpm: 136, musicTitle: 'Composed: F# dorian, 136 BPM' },
      }).music,
    ).toEqual({ result: 'Composed: F# dorian, 136 BPM', state: 'done' })
  })

  it('plan and build come from the reel folder', () => {
    const dir = reelDir()
    fs.mkdirSync(path.join(dir, 'src', 'scenes'), { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'plan.md'),
      '# Plan\n\n## Intro\n- Scene 1: logo\n- Scene 2: title\n## Drop\n### Scene 3: grid\n',
    )
    fs.writeFileSync(path.join(dir, 'src', 'scenes', 'Intro.tsx'), 'x')
    fs.writeFileSync(path.join(dir, 'src', 'scenes', 'Drop.tsx'), 'x')
    fs.writeFileSync(path.join(dir, 'src', 'scenes', 'notes.md'), 'x')
    const facts = readReelFacts(dir)
    expect(facts.plan).toEqual({ scenes: 3, sections: 2 })
    expect(facts.scenes.names).toEqual(['Drop.tsx', 'Intro.tsx'])
    expect(facts.musicScore).toBe(false)

    const t = tasks({ facts, setup: SETUP, working: true })
    expect(t.plan).toEqual({ result: 'plan.md: 2 sections, 3 scenes', state: 'done' })
    // Scenes changing while the agent works, with no render after them: being built.
    expect(t.build).toEqual({
      details: ['Drop.tsx', 'Intro.tsx'],
      result: '2 scene files',
      state: 'running',
    })
    expect(tasks({ facts, setup: SETUP, working: false }).build.state).toBe('done')
    const rendered = [call('motion_render', true, RENDER_PASS, facts.scenes.lastChange + 10)]
    expect(tasks({ calls: rendered, facts, setup: SETUP, working: true }).build.state).toBe('done')
  })

  it('a missing reel folder reads as nothing there', () => {
    expect(readReelFacts(reelDir())).toEqual(noFacts)
  })

  it('look counts the stills over every look and lists the last one', () => {
    const t = tasks({
      calls: [call('motion_still', true, STILLS), call('motion_still', true, STILLS)],
      setup: SETUP,
    })
    expect(t.look).toEqual({
      details: ['beat 4 (frame 113)', 'beat 12 (frame 338)'],
      result: '4 stills over 2 looks',
      state: 'done',
    })
    expect(
      tasks({ calls: [call('motion_still', true, STILLS), call('motion_still')] }).look.state,
    ).toBe('running')
  })

  it('render counts the fix loop and sync reads its verdict', () => {
    const first = tasks({ calls: [call('motion_render', true, RENDER_FAIL)], setup: SETUP })
    expect(first.render).toEqual({ result: 'Render 1 of 3', state: 'done' })
    expect(first.sync).toEqual({
      details: [
        'Cuts: 6 of 7 on the grid.',
        'Kick pulse: none.',
        'Sync: 2 to fix: kick pulse, section starts.',
      ],
      result: '2 to fix: kick pulse, section starts',
      state: 'failed',
    })

    const second = tasks({
      calls: [call('motion_render', true, RENDER_FAIL), call('motion_render')],
      setup: SETUP,
    })
    expect(second.render).toEqual({ result: 'Rendering 2 of 3…', state: 'running' })
    expect(second.sync.state).toBe('running')

    const passed = tasks({
      calls: [call('motion_render', true, RENDER_FAIL), call('motion_render', true, RENDER_PASS)],
      setup: SETUP,
    })
    expect(passed.render.result).toBe('Render 2 of 3')
    expect(passed.sync).toEqual({
      details: ['Cuts: 7 of 7 on the grid.', 'Sync: passes.'],
      result: 'Sync: passes',
      state: 'done',
    })

    const broken = tasks({
      calls: [
        call('motion_render', true, RENDER_PASS),
        call('motion_render', false, 'The render failed:\nerr'),
      ],
      setup: SETUP,
    })
    expect(broken.render).toEqual({
      details: ['err'],
      result: 'The render failed: err',
      state: 'failed',
    })
    // The last render that went through still has the word on the sync.
    expect(broken.sync.result).toBe('Sync: passes')
  })
})

const REVIEW = [
  'Made 3 contact sheets of the render (the user sees them too): a frame every 0.5 s from 0 s to 30 s, 8 to a row (4 s), left to right. Open every sheet:',
  '- reel/out/review/1/sheet-1.png: rows start at 0 s (beat 0), 4 s (beat 8), 8 s (beat 16)',
  '',
  'Pace report (the whole reel):',
  'Shots (from the cuts and big changes; one idea is at most 4 s, a shot over 8 s fails):',
  '- 0 s (beat 0): 2 s',
  'Scenes: 1 shot, the longest 2 s.',
  'Stalls: 2 where nothing visibly moves for 0.5 s or more before the end card at 27 s: 3.5-4.4 s (beats 7-8.8), 9-9.9 s (beats 18-19.8).',
  'Pace: 2 stalls to fix.',
  '',
  'Write what you find in reel/review.md.',
].join('\n')

describe('motionTasks: the review', () => {
  it('waits for a review, runs while it makes its sheets, and is done with the sheets and the round', () => {
    expect(tasks({ setup: SETUP }).review).toEqual({ result: null, state: 'waiting' })
    const rendered = call('motion_render', true, RENDER_PASS, 1000)
    expect(
      tasks({ calls: [rendered, call('motion_review', undefined, undefined, 2000)] }).review,
    ).toEqual({
      result: 'Making contact sheets…',
      state: 'running',
    })
    const reviewed = [rendered, call('motion_review', true, REVIEW, 2000)]
    expect(tasks({ calls: reviewed }).review).toEqual({
      details: [
        'Scenes: 1 shot, the longest 2 s.',
        'Stalls: 2 where nothing visibly moves for 0.5 s or more before the end card at 27 s: 3.5-4.4 s (beats 7-8.8), 9-9.9 s (beats 18-19.8).',
        'Pace: 2 stalls to fix.',
      ],
      result: '3 sheets, round 1',
      state: 'done',
    })
    // The render phase keeps counting renders.
    expect(tasks({ calls: reviewed }).render.result).toBe('Render 1 of 3')
  })

  it("shows review.md's problem count, else its first line; the second render's review is round 2", () => {
    const calls = [
      call('motion_render', true, RENDER_PASS, 1000),
      call('motion_review', true, REVIEW, 2000),
      call('motion_render', true, RENDER_PASS, 3000),
      call('motion_review', true, REVIEW, 4000),
    ]
    const facts = { ...noFacts, review: { firstLine: 'Round 2', problems: 3 } }
    expect(tasks({ calls, facts }).review.result).toBe('3 sheets, round 2 · review.md: 3 problems')
    const noList = { ...noFacts, review: { firstLine: 'Round 2: all clear', problems: 0 } }
    expect(tasks({ calls, facts: noList }).review.result).toBe(
      '3 sheets, round 2 · review.md: Round 2: all clear',
    )
    // A newer render is not reviewed yet.
    const newer = [...calls, call('motion_render', true, RENDER_PASS, 5000)]
    expect(tasks({ calls: newer, facts }).review).toMatchObject({
      result: '3 sheets, round 2 · review.md: 3 problems; render 3 not reviewed yet',
      state: 'waiting',
    })
  })

  it('a review refused before a render says why', () => {
    const refused = call(
      'motion_review',
      false,
      'Nothing to review yet: render the reel with motion_render first, then call motion_review.',
    )
    expect(tasks({ calls: [refused] }).review).toEqual({
      result:
        'Nothing to review yet: render the reel with motion_render first, then call motion_review.',
      state: 'failed',
    }) // A render after the refusal: that render waits for its review, the refusal is stale.
    const stale = [
      call('motion_review', false, 'Nothing to review yet: render the reel first.', 1000),
      call('motion_render', true, RENDER_PASS, 2000),
    ]
    expect(tasks({ calls: stale }).review).toEqual({
      result: 'Render 1 not reviewed yet',
      state: 'waiting',
    })
    // After an earlier review, a refused one before the next render keeps that review's result.
    const again = [
      call('motion_render', true, RENDER_PASS, 1000),
      call('motion_review', true, REVIEW, 2000),
      call('motion_review', false, 'src/scenes/A.tsx changed after the last render.', 3000),
      call('motion_render', true, RENDER_PASS, 4000),
    ]
    expect(tasks({ calls: again }).review).toMatchObject({
      result: '3 sheets, round 1; render 2 not reviewed yet',
      state: 'waiting',
    })
  })

  it('reads review.md from the reel folder: its first line and its list items', () => {
    const dir = reelDir()
    fs.mkdirSync(dir, { recursive: true })
    expect(readReelFacts(dir).review).toBeNull()
    fs.writeFileSync(
      path.join(dir, 'review.md'),
      '# Review, round 1\n\n- 3.5 s: stall, add a drift\n- 9 s: stall\n1. 14 s: scene 6 s, split\n',
    )
    expect(readReelFacts(dir).review).toEqual({ firstLine: 'Review, round 1', problems: 3 })
  })
})

describe('MotionTaskTracker', () => {
  function tracker(mode: AgentSession['mode'] = 'motion') {
    const workspace = path.dirname(reelDir())
    const events: AgentMotionTask[][] = []
    let session = { id: 's1', mode, motionReel: SETUP, status: 'running' } as AgentSession
    const make = () =>
      new MotionTaskTracker({
        emitAutonomousEvent: (_id, event) => events.push(event.tasks),
        getSession: () => session,
        workingDir: () => workspace,
      })
    return {
      events,
      make,
      setStatus: (status: AgentSession['status']) => (session = { ...session, status }),
      workspace,
    }
  }
  const stateOf = (list: AgentMotionTask[] | undefined, id: string) =>
    list?.find((t) => t.id === id)?.state

  it('sends the phases as a call starts and ends, and keeps the calls in the reel folder', async () => {
    const { events, make, workspace } = tracker()
    const tasksNow = make()
    const result = await tasksNow.track('s1', 'motion_render', async () => {
      expect(stateOf(events.at(-1), 'render')).toBe('running')
      return { success: true, text: RENDER_PASS }
    })
    expect(result.success).toBe(true)
    expect(events).toHaveLength(2)
    expect(stateOf(events[1], 'render')).toBe('done')
    expect(events[1]?.find((t) => t.id === 'sync')?.result).toBe('Sync: passes')
    expect(fs.existsSync(path.join(workspace, 'reel', 'out', 'motion-tasks.json'))).toBe(true)

    // After a restart, the calls are read back.
    const later = tracker()
    const again = new MotionTaskTracker({
      emitAutonomousEvent: (_id, event) => later.events.push(event.tasks),
      getSession: () =>
        ({ id: 's1', mode: 'motion', motionReel: SETUP, status: 'idle' }) as AgentSession,
      workingDir: () => workspace,
    })
    again.turnEnded('s1')
    expect(stateOf(later.events[0], 'render')).toBe('done')
  })

  it('a composer motion_music call shows in Music: composing, then its title', async () => {
    const workspace = path.dirname(reelDir())
    const events: AgentMotionTask[][] = []
    const composer: AgentMotionSetupView = {
      ...SETUP,
      music: { engine: 'composer', source: 'agent' },
    }
    let session = {
      id: 's1',
      mode: 'motion',
      motionReel: composer,
      status: 'running',
    } as AgentSession
    const tasksNow = new MotionTaskTracker({
      emitAutonomousEvent: (_id, event) => events.push(event.tasks),
      getSession: () => session,
      workingDir: () => workspace,
    })
    const music = (list: AgentMotionTask[] | undefined) => list?.find((t) => t.id === 'music')
    await tasksNow.track('s1', 'motion_music', async () => {
      expect(music(events.at(-1))).toMatchObject({ result: 'Composing…', state: 'running' })
      // What the service's refit does once the score is put under the reel.
      session = {
        ...session,
        motionReel: { ...composer, bpm: 136, musicTitle: 'Composed: F# dorian, 136 BPM' },
      }
      return { success: true, text: 'Composed: F# dorian, 136 BPM. Put under the reel.' }
    })
    expect(music(events.at(-1))).toMatchObject({
      result: 'Composed: F# dorian, 136 BPM',
      state: 'done',
    })
  })

  it('a failed or throwing call ends failed; the error still reaches the caller', async () => {
    const { events, make } = tracker()
    const tasksNow = make()
    await expect(
      tasksNow.track('s1', 'motion_still', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(stateOf(events.at(-1), 'look')).toBe('failed')
  })

  it("doesn't keep a call made while another runs (the service refuses it)", async () => {
    const { events, make } = tracker()
    const tasksNow = make()
    let finish: (() => void) | undefined
    const first = tasksNow.track(
      's1',
      'motion_render',
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ success: true, text: RENDER_PASS })
        }),
    )
    const refused = await tasksNow.track('s1', 'motion_still', async () => ({
      success: false,
      text: 'A render or setup is already running; wait for it.',
    }))
    expect(refused.success).toBe(false)
    finish?.()
    await first
    expect(stateOf(events.at(-1), 'look')).toBe('waiting')
  })

  it('sends the same list once, and nothing for a chat that is not a Motion Reel', () => {
    const { events, make, setStatus } = tracker()
    const tasksNow = make()
    tasksNow.turnEnded('s1')
    tasksNow.turnEnded('s1')
    expect(events).toHaveLength(1)
    setStatus('idle')
    tasksNow.turnEnded('s1')
    expect(events).toHaveLength(1)

    const other = tracker('free')
    other.make().turnEnded('s1')
    expect(other.events).toEqual([])
  })
})

describe('motionTasks: refusals, failures and shell work', () => {
  const composer: AgentMotionSetupView = {
    ...SETUP,
    music: { engine: 'composer', source: 'agent' },
  }

  it("a call refused because the reel doesn't type-check is Build's, not the tool's", () => {
    const refused: MotionToolCall = {
      ...call(
        'motion_music',
        false,
        "The reel doesn't type-check; fix these first:\nsrc/scenes/A.tsx(3,1): error",
      ),
      refused: 'type-check',
    }
    const scenes = { lastChange: 500, names: ['A.tsx'] }
    const now = tasks({ calls: [refused], facts: { ...noFacts, scenes }, setup: composer })
    expect(now.music.state).toBe('waiting')
    expect(now.build).toEqual({
      details: ['src/scenes/A.tsx(3,1): error'],
      result: "Doesn't type-check",
      state: 'failed',
    })
    // Scenes changed since: the agent is fixing them.
    const fixed = { lastChange: 2000, names: ['A.tsx'] }
    expect(tasks({ calls: [refused], facts: { ...noFacts, scenes: fixed } }).build.state).toBe(
      'done',
    )
  })

  it('a failure says why on its row and keeps the rest as details', () => {
    const failed = call('motion_render', false, 'The render failed:\nChrome exited\nat frame 120')
    expect(tasks({ calls: [failed] }).render).toEqual({
      details: ['Chrome exited', 'at frame 120'],
      result: 'The render failed: Chrome exited',
      state: 'failed',
    })
  })

  it('music is running while the agent composes in its shell, between motion_music calls', () => {
    const facts = { ...noFacts, musicChangedAt: 5000, musicScore: true }
    expect(tasks({ facts, setup: composer, working: true }).music).toEqual({
      result: 'Composing in reel/music/ (the composer)…',
      state: 'running',
    })
    // Not while the turn is over, and not when the last motion_music came after the change.
    expect(tasks({ facts, setup: composer }).music.state).toBe('waiting')
    const after = call('motion_music', true, 'ok', 6000)
    expect(
      tasks({
        calls: [after],
        facts,
        setup: { ...composer, musicTitle: 'Composed: x' },
        working: true,
      }).music.state,
    ).toBe('done')
  })

  it('reads when the score last changed from the reel folder', () => {
    const dir = reelDir()
    fs.mkdirSync(path.join(dir, 'music', 'audio'), { recursive: true })
    expect(readReelFacts(dir).musicChangedAt).toBe(0)
    fs.writeFileSync(path.join(dir, 'music', 'audio', 'score.wav'), 'x')
    expect(readReelFacts(dir).musicChangedAt).toBeGreaterThan(0)
  })
})

describe('MotionTaskTracker: live turns', () => {
  afterEach(() => jest.useRealTimers())

  it('reads the phases again while a turn runs, and stops when it ends', () => {
    jest.useFakeTimers()
    const workspace = path.dirname(reelDir())
    const events: AgentMotionTask[][] = []
    let session = { id: 's1', mode: 'motion', motionReel: SETUP, status: 'running' } as AgentSession
    const tracker = new MotionTaskTracker({
      emitAutonomousEvent: (_id, event) => events.push(event.tasks),
      getSession: () => session,
      workingDir: () => workspace,
    })
    tracker.turnStarted('s1')
    expect(events).toHaveLength(1)
    // The agent writes a scene in its shell: the next read shows Build running.
    fs.mkdirSync(path.join(workspace, 'reel', 'src', 'scenes'), { recursive: true })
    fs.writeFileSync(path.join(workspace, 'reel', 'src', 'scenes', 'A.tsx'), 'x')
    jest.advanceTimersByTime(3000)
    expect(events.at(-1)?.find((t) => t.id === 'build')).toMatchObject({
      result: '1 scene file',
      state: 'running',
    })
    session = { ...session, status: 'stopped' }
    jest.advanceTimersByTime(3000)
    expect(events.at(-1)?.find((t) => t.id === 'build')?.state).toBe('done')
    const sent = events.length
    jest.advanceTimersByTime(10_000)
    expect(events).toHaveLength(sent)
  })

  it('a call refused as busy is not kept; one refused for type errors goes to Build', async () => {
    const workspace = path.dirname(reelDir())
    const events: AgentMotionTask[][] = []
    const tracker = new MotionTaskTracker({
      emitAutonomousEvent: (_id, event) => events.push(event.tasks),
      getSession: () =>
        ({ id: 's1', mode: 'motion', motionReel: SETUP, status: 'running' }) as AgentSession,
      workingDir: () => workspace,
    })
    await tracker.track('s1', 'motion_render', async () => ({
      refused: 'busy',
      success: false,
      text: 'A render or setup is already running; wait for it.',
    }))
    expect(events.at(-1)?.find((t) => t.id === 'render')?.state).toBe('waiting')
    await tracker.track('s1', 'motion_render', async () => ({
      refused: 'type-check',
      success: false,
      text: "The reel doesn't type-check; fix these first:\nerror",
    }))
    const last = events.at(-1)
    expect(last?.find((t) => t.id === 'render')?.state).toBe('waiting')
    expect(last?.find((t) => t.id === 'build')).toMatchObject({
      result: "Doesn't type-check",
      state: 'failed',
    })
  })
})

describe('the plan in the Tasks panel', () => {
  it('reads plan.md as text with when it changed; a missing file or a link reads as none', () => {
    const dir = reelDir()
    expect(readPlanText(dir)).toBeNull()
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'plan.md')
    fs.writeFileSync(file, '# Plan\n- Scene 1 (bars 0-2): logo <script>x</script>\n')
    expect(readPlanText(dir)).toEqual({
      changedAt: fs.statSync(file).mtimeMs,
      text: '# Plan\n- Scene 1 (bars 0-2): logo <script>x</script>\n',
      truncated: false,
    })
    // A link to a file elsewhere is not followed.
    const outside = path.join(path.dirname(dir), 'secret.txt')
    fs.writeFileSync(outside, 'secret')
    fs.rmSync(file)
    fs.symlinkSync(outside, file)
    expect(readPlanText(dir)).toBeNull()
  })

  it('keeps only the start of a long plan, never half a character', () => {
    const dir = reelDir()
    fs.mkdirSync(dir, { recursive: true })
    // A two-byte character repeated: the cap falls inside one.
    fs.writeFileSync(path.join(dir, 'plan.md'), `a${'é'.repeat(MAX_PLAN_TEXT_BYTES)}`)
    const plan = readPlanText(dir)
    expect(plan?.truncated).toBe(true)
    expect(Buffer.byteLength(plan?.text ?? '')).toBeLessThanOrEqual(MAX_PLAN_TEXT_BYTES)
    expect(plan?.text).toMatch(/^aé+$/)
  })

  it('sends the plan with the list when it changed, and leaves it out when it did not', () => {
    const workspace = path.dirname(reelDir())
    const events: { plan?: AgentMotionPlan | null; tasks: AgentMotionTask[] }[] = []
    const tracker = new MotionTaskTracker({
      emitAutonomousEvent: (_id, event) => events.push(event),
      getSession: () =>
        ({ id: 's1', mode: 'motion', motionReel: SETUP, status: 'running' }) as AgentSession,
      workingDir: () => workspace,
    })
    // The first list says there is no plan yet.
    tracker.turnEnded('s1')
    expect(events).toHaveLength(1)
    expect(events[0]?.plan).toBeNull()

    // The agent writes plan.md, then asks to build it: the plan goes before the card.
    const file = path.join(workspace, 'reel', 'plan.md')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '# Plan\n- Scene 1 (bars 0-2): logo\n')
    tracker.questionAsked('s1')
    expect(events).toHaveLength(2)
    expect(events[1]?.plan?.text).toBe('# Plan\n- Scene 1 (bars 0-2): logo\n')
    expect(events[1]?.tasks.find((t) => t.id === 'plan')?.state).toBe('done')

    // Nothing changed: nothing is sent.
    tracker.turnEnded('s1')
    expect(events).toHaveLength(2)

    // Only the plan's words changed (its counts did not): the list goes again, with the plan.
    fs.writeFileSync(file, '# Plan\n- Scene 1 (bars 0-4): the logo\n')
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000))
    tracker.turnEnded('s1')
    expect(events).toHaveLength(3)
    expect(events[2]?.plan?.text).toBe('# Plan\n- Scene 1 (bars 0-4): the logo\n')

    // The list changes but the plan does not: no plan in the event.
    fs.mkdirSync(path.join(workspace, 'reel', 'src', 'scenes'), { recursive: true })
    fs.writeFileSync(path.join(workspace, 'reel', 'src', 'scenes', 'A.tsx'), 'x')
    tracker.turnEnded('s1')
    expect(events).toHaveLength(4)
    expect('plan' in (events[3] ?? {})).toBe(false)

    // The plan is deleted: null says so.
    fs.rmSync(file)
    tracker.turnEnded('s1')
    expect(events.at(-1)?.plan).toBeNull()
  })
})
