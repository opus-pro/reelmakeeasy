import path from 'node:path'

import { BGM_DEFAULT_VOLUME } from '@reelmakeeasy/common/long-take/bgm-volume'
import { filesRoot } from '@reelmakeeasy/common/storage/file-store'
import {
  ActivityFailure,
  ApplicationFailure,
  WorkflowFailedError,
} from '@reelmakeeasy/workflow-engine/common'

import { AgentEditService, EditNotReadyError } from './agent-edit.service'

/** A loop's storyboard as stored after a redo's changes (what the Storyboard panel shows). */
const LOOP_STORYBOARD = {
  clips: [
    { id: 's1', narration: 'Honey found in tombs was still good to eat.', stamp: 'EGYPT' },
    { id: 's2', narration: 'Bees fan the nectar with their wings.', stamp: '3,000 YEARS' },
    { id: 's3', narration: 'That leaves too little water for germs.', stamp: null },
    { id: 's4', narration: 'So a jar of honey can outlast us all.', stamp: 'FOREVER' },
  ],
  duration_s: 16,
  title: 'Honey keeps',
}

const DEFAULT_STATE = {
  data: {
    keyframes: [
      { keyframeUrl: 'store://k1.png', shotId: '1' },
      { keyframeUrl: 'store://k2.png', shotId: '2' },
    ],
    transitions: [
      {
        endMs: 7060,
        fromShotId: '1',
        prompt: 'old',
        startMs: 0,
        toShotId: '2',
        transitionId: 'transition_0',
        videoUri: 'store://t0.mp4',
      },
    ],
  },
}

function makeEdit(
  over: {
    /** The project is a loop short (`isBeatLoopProject`). */
    loop?: boolean
    /** `regenerateLoopClip`'s answer (default: clip s2 of four, the two after it kept). */
    loopRedo?: (clipId: string, opts: { redoFollowing?: boolean }) => Promise<unknown>
    /** `makeBeatLoop`'s answer. */
    makeLoop?: unknown
    /** Extra project fields (the bgm state) `getProject` returns. */
    project?: Record<string, unknown>
    /** `updateBgmSettings`'s answer (default: a started remux). */
    remux?: { remux: string; workflowId?: string }
    session?: Record<string, unknown>
    state?: unknown
    status?: null | { stage: string; videoUrl: null | string }
    waits?: Record<string, unknown>
  } = {},
) {
  const session = {
    editing: true,
    flowActive: false,
    id: 's1',
    mode: 'autonomous',
    projectId: 'p1',
    status: 'idle',
    ...over.session,
  }
  const sessions = {
    beginEditing: jest.fn(),
    clearFlowCancelled: jest.fn(),
    emitAutonomousEvent: jest.fn(),
    getSession: jest.fn(() => session),
    isFlowCancelled: jest.fn(() => false),
    linkProject: jest.fn(),
    sessionDir: jest.fn(() => '/data/agent/s1'),
    workingDir: jest.fn(() => '/data/agent/s1/edit'),
  }
  const generateImage = jest.fn(async () => ({ success: true, text: 'Saved the image to /x.png' }))
  const longTake = {
    getStateWithUnrenderedChanges: jest.fn(async () => over.state ?? DEFAULT_STATE),
    getStatus: jest.fn(async () =>
      over.status === undefined ? { stage: 'completed', videoUrl: 'http://v' } : over.status,
    ),
    regenerateTransitionFromState: jest.fn(async () => ({
      workflowId: 'ao:p1:story-mode:transition-regen:transition_0',
    })),
    renderFromState: jest.fn(async () => ({ workflowId: 'ao:p1:story-mode:render' })),
    createBgmVersion: jest.fn(async () => ({ workflowId: 'wf-m' })),
    isBeatLoopProject: jest.fn(async () => over.loop ?? false),
    regenerateLoopClip: jest.fn(
      async (_projectId: string, clipId: string, opts: { redoFollowing?: boolean }) =>
        over.loopRedo
          ? over.loopRedo(clipId, opts)
          : {
              clipIds: opts.redoFollowing ? [clipId, 's3', 's4'] : [clipId],
              clipUsd: 0.16,
              estimatedCostUsd: opts.redoFollowing ? 0.48 : 0.16,
              followingClipIds: ['s3', 's4'],
              projectId: 'p1',
              redoFollowing: opts.redoFollowing ?? false,
              storyboard: LOOP_STORYBOARD,
              workflowId: 'ao:p1:story-mode',
            },
    ),
    updateBgmSettings: jest.fn(async () => over.remux ?? { remux: 'started', workflowId: 'wf-m' }),
  }
  const projects = {
    getProject: jest.fn(async () => ({
      cameraStyle: 'dynamic',
      generationResolution: { videoResolution: '768p' },
      id: 'p1',
      ...over.project,
    })),
  }
  const music = {
    catalog: jest.fn(async () => ({
      library: [{ id: 'bright-steps', title: 'Bright Steps' }],
      mine: [{ id: 't1', name: 'Brand theme' }],
    })),
  }
  const cancelled: string[] = []
  // Like the real one: the first call opens the card (false), later calls replace the brief (true).
  let cardOpen = false
  const autonomous = {
    // Async, like the real one: it says every line in the voice before it answers.
    makeBeatLoop: jest.fn(
      async () =>
        over.makeLoop ?? {
          clipUsd: 0.16,
          clips: 4,
          durationSeconds: 16,
          estimatedCostUsd: 0.8,
          format: 'beat_loop',
          status: 'waiting_for_make_it',
          warnings: [],
        },
    ),
    requestStyle: jest.fn(() => {
      const replaced = cardOpen
      cardOpen = true
      return replaced
    }),
  }
  const waitForWorkflow = jest.fn(
    async (id: string, _timeoutMs: number) =>
      over.waits?.[id] ?? {
        results: [{ fileUri: 'store://t0-v2.mp4', transitionId: 'transition_0' }],
      },
  )
  const svc = new AgentEditService({
    autonomous: autonomous as never,
    cancelWorkflow: async (id) => {
      cancelled.push(id)
    },
    generateImage,
    longTake: longTake as never,
    music: music as never,
    projects: projects as never,
    sessions: sessions as never,
    user: () => ({ sub: 'u', userId: 'u' }) as never,
    waitForWorkflow,
  })
  return {
    autonomous,
    cancelled,
    generateImage,
    longTake,
    music,
    projects,
    session,
    sessions,
    svc,
    waitForWorkflow,
  }
}

describe('AgentEditService.startEditing', () => {
  it('enters edit mode for a finished project', async () => {
    const t = makeEdit()
    await t.svc.startEditing('s1')
    expect(t.sessions.beginEditing).toHaveBeenCalledWith(
      's1',
      path.join(filesRoot(), 'projects', 'p1'),
    )
  })

  it('refuses while the flow runs, without a project, or before the video is delivered', async () => {
    await expect(
      makeEdit({ session: { flowActive: true } }).svc.startEditing('s1'),
    ).rejects.toBeInstanceOf(EditNotReadyError)
    await expect(
      makeEdit({ session: { projectId: null } }).svc.startEditing('s1'),
    ).rejects.toBeInstanceOf(EditNotReadyError)
    await expect(
      makeEdit({ status: { stage: 'transitions', videoUrl: null } }).svc.startEditing('s1'),
    ).rejects.toBeInstanceOf(EditNotReadyError)
    await expect(makeEdit({ status: null }).svc.startEditing('s1')).rejects.toBeInstanceOf(
      EditNotReadyError,
    )
  })
})

describe('AgentEditService.callTool', () => {
  it('generate_image makes a picture in the session folder', async () => {
    const { generateImage, svc } = makeEdit({ session: { projectId: null } })
    await expect(svc.callTool('s1', 'generate_image', { prompt: 'fox' })).resolves.toEqual({
      success: true,
      text: 'Saved the image to /x.png',
    })
    expect(generateImage).toHaveBeenCalledWith({ prompt: 'fox' }, { sessionDir: '/data/agent/s1' })
  })

  it("generate_image, once there is a video, may start from the video's pictures", async () => {
    const { generateImage, svc } = makeEdit()
    await svc.callTool('s1', 'generate_image', { prompt: 'fix the hand' })
    expect(generateImage).toHaveBeenCalledWith(
      { prompt: 'fix the hand' },
      {
        referenceRoots: expect.arrayContaining([
          '/data/agent/s1',
          path.join(filesRoot(), 'projects', 'p1'),
        ]),
        sessionDir: '/data/agent/s1',
        workingDir: '/data/agent/s1/edit',
      },
    )
  })

  it('regenerate_clip redoes a known clip and reports the file, timing and cost', async () => {
    const t = makeEdit()
    // The run writes the new clip under a name of its own: the reply names that file, not the
    // old one a check would otherwise pull frames from.
    const remade = structuredClone(DEFAULT_STATE)
    remade.data.transitions[0].videoUri =
      'http://localhost:5017/api/files/projects/p1/long_take/transitions/transition_0-rk7x.mp4'
    t.longTake.getStateWithUnrenderedChanges
      .mockResolvedValueOnce(DEFAULT_STATE)
      .mockResolvedValueOnce(remade)
    const r = await t.svc.callTool('s1', 'regenerate_clip', {
      prompt: '[0:00.000-0:04.000] fast',
      transitionId: 'transition_0',
    })
    expect(r.success).toBe(true)
    expect(t.longTake.regenerateTransitionFromState).toHaveBeenCalledWith(
      'p1',
      'transition_0',
      '[0:00.000-0:04.000] fast',
      expect.anything(),
      { promptIsFinal: true },
    )
    expect(JSON.parse(r.text)).toMatchObject({
      cameraStyle: 'dynamic',
      durationSeconds: 7.06,
      estimatedCostUsd: expect.any(Number),
      transitionId: 'transition_0',
      videoPath: 'project/long_take/transitions/transition_0-rk7x.mp4',
    })
    expect(t.sessions.clearFlowCancelled).toHaveBeenCalledWith('s1')
  })

  it('regenerate_clip with an unknown id lists the real clips instead of throwing', async () => {
    const r = await makeEdit().svc.callTool('s1', 'regenerate_clip', {
      prompt: 'p',
      transitionId: 'transition_9',
    })
    expect(r.success).toBe(false)
    expect(r.text).toContain('No clip transition_9')
    expect(r.text).toContain('transition_0 (0.0-7.1 s)')
  })

  it('refuses a second regeneration while one runs on the project', async () => {
    const t = makeEdit({
      waits: { 'ao:p1:story-mode:transition-regen:transition_0': new Promise(() => undefined) },
    })
    const first = t.svc.callTool('s1', 'regenerate_clip', {
      prompt: 'p',
      transitionId: 'transition_0',
    })
    await new Promise((r) => setTimeout(r, 20))
    const second = await t.svc.callTool('s1', 'regenerate_clip', {
      prompt: 'p',
      transitionId: 'transition_0',
    })
    expect(second).toEqual({ success: false, text: 'A clip is already being redone; wait for it.' })
    t.sessions.isFlowCancelled.mockReturnValue(true)
    await first
  })

  it('holds the project while a redo or a render starts, and frees it if the start fails', async () => {
    const t = makeEdit()
    let release: () => void = () => undefined
    t.longTake.regenerateTransitionFromState.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ workflowId: 'ao:p1:story-mode:transition-regen:transition_0' })
        }),
    )
    const first = t.svc.callTool('s1', 'regenerate_clip', {
      prompt: 'p',
      transitionId: 'transition_0',
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(await t.svc.callTool('s1', 'render_video', {})).toEqual({
      success: false,
      text: 'A clip is already being redone; wait for it.',
    })
    release()
    expect((await first).success).toBe(true)

    t.longTake.renderFromState.mockRejectedValueOnce(new Error('No state to render.'))
    expect(await t.svc.callTool('s1', 'render_video', {})).toEqual({
      success: false,
      text: 'No state to render.',
    })
    expect((await t.svc.callTool('s1', 'render_video', {})).success).toBe(true)
  })

  it('Stop while waiting cancels the workflow and answers Stopped', async () => {
    const t = makeEdit({
      waits: { 'ao:p1:story-mode:transition-regen:transition_0': new Promise(() => undefined) },
    })
    t.sessions.isFlowCancelled.mockReturnValue(true)
    const r = await t.svc.callTool('s1', 'regenerate_clip', {
      prompt: 'p',
      transitionId: 'transition_0',
    })
    expect(r).toEqual({ success: false, text: 'Stopped.' })
    expect(t.cancelled).toEqual(['ao:p1:story-mode:transition-regen:transition_0'])
  })

  it('render_video rebuilds from the current state and reports the video path', async () => {
    const t = makeEdit({ waits: { 'ao:p1:story-mode:render': { videoUri: 'store://final.mp4' } } })
    const r = await t.svc.callTool('s1', 'render_video', {})
    expect(r.success).toBe(true)
    expect(t.longTake.renderFromState).toHaveBeenCalledWith('p1', expect.anything())
    expect(JSON.parse(r.text)).toMatchObject({ videoPath: 'project/final_video.mp4' })
  })

  it('edit tools answer "No finished video yet." without a finished project, and unknown tools are refused', async () => {
    const t = makeEdit({ status: { stage: 'transitions', videoUrl: null } })
    expect(await t.svc.callTool('s1', 'render_video', {})).toEqual({
      success: false,
      text: 'No finished video yet.',
    })
    expect(await t.svc.callTool('s1', 'nope', {})).toEqual({
      success: false,
      text: 'Unknown tool nope.',
    })
  })

  it('a failed workflow is reported as text, not thrown', async () => {
    const t = makeEdit({
      waits: { 'ao:p1:story-mode:render': Promise.reject(new Error('render exploded')) },
    })
    const r = await t.svc.callTool('s1', 'render_video', {})
    expect(r).toEqual({ success: false, text: 'Failed: render exploded' })
  })
})

describe('make_video', () => {
  const script = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')

  it('records the brief and asks for a style', async () => {
    const t = makeEdit({ session: { mode: 'free', projectId: null } })
    const r = await t.svc.callTool('s1', 'make_video', {
      cameraStyle: 'dynamic',
      script,
      title: 'Moon caves',
    })
    expect(r).toEqual({ success: true, text: JSON.stringify({ status: 'waiting_for_style' }) })
    expect(t.autonomous.requestStyle).toHaveBeenCalledWith('s1', {
      brief: 'Moon caves',
      cameraStyle: 'dynamic',
      durationSeconds: 24,
      music: { choice: 'auto' },
      script,
      title: 'Moon caves',
    })
  })

  it.each([
    ['off', { choice: 'off' }],
    ['warm guitar', { choice: 'auto', note: 'warm guitar' }],
    [undefined, { choice: 'auto' }],
  ])('maps the music text %s onto the brief', async (music, expected) => {
    const t = makeEdit({ session: { mode: 'free', projectId: null } })
    await t.svc.callTool('s1', 'make_video', { music, script, title: 't' })
    expect(t.autonomous.requestStyle).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ music: expected }),
    )
  })

  it('refuses a short script and a chat that already has a video', async () => {
    const t = makeEdit({ session: { mode: 'free', projectId: null } })
    expect(await t.svc.callTool('s1', 'make_video', { script: 'too short', title: 't' })).toEqual({
      success: false,
      text: 'The script must be 25 to 250 words (15-90 seconds of narration).',
    })
    expect(
      await makeEdit({ session: { mode: 'free' } }).svc.callTool('s1', 'make_video', {
        script,
        title: 't',
      }),
    ).toEqual({
      success: false,
      text: 'This chat already made a video; use regenerate_clip and render_video to change it.',
    })
  })

  it('a second make_video while the style card is open replaces the script for the pick', async () => {
    const t = makeEdit({ session: { mode: 'free', projectId: null } })
    await t.svc.callTool('s1', 'make_video', { script, title: 'first' })
    const r = await t.svc.callTool('s1', 'make_video', {
      script: `${script} changed`,
      title: 'second',
    })
    expect(r).toEqual({
      success: true,
      text: JSON.stringify({
        status: 'waiting_for_style',
        note: 'The script was updated; the style card is still open.',
      }),
    })
    expect(t.autonomous.requestStyle).toHaveBeenLastCalledWith(
      's1',
      expect.objectContaining({ script: `${script} changed`, title: 'second' }),
    )
  })
})

describe('review fixes: waits and refresh', () => {
  it('a timed-out wait cancels the workflow and reports the failure', async () => {
    const t = makeEdit({
      waits: {
        'ao:p1:story-mode:transition-regen:transition_0': Promise.reject(
          new Error('Timed out after 10 minutes.'),
        ),
      },
    })
    const r = await t.svc.callTool('s1', 'regenerate_clip', {
      prompt: 'p',
      transitionId: 'transition_0',
    })
    expect(r).toEqual({ success: false, text: 'Failed: Timed out after 10 minutes.' })
    expect(t.cancelled).toEqual(['ao:p1:story-mode:transition-regen:transition_0'])
  })

  it('a finished render tells the page the video changed', async () => {
    const t = makeEdit({ waits: { 'ao:p1:story-mode:render': { videoUri: 'store://final.mp4' } } })
    await t.svc.callTool('s1', 'render_video', {})
    expect(t.sessions.emitAutonomousEvent).toHaveBeenCalledWith('s1', {
      projectId: 'p1',
      type: 'video_rendered',
    })
  })
})

describe('set_music', () => {
  const user = { sub: 'u', userId: 'u' }

  it('does nothing while the video is still rendering', async () => {
    const t = makeEdit({ status: { stage: 'transitions', videoUrl: null } })
    expect(await t.svc.callTool('s1', 'set_music', { enabled: false })).toEqual({
      success: false,
      text: 'No finished video yet.',
    })
    expect(t.longTake.updateBgmSettings).not.toHaveBeenCalled()
    expect(t.longTake.createBgmVersion).not.toHaveBeenCalled()
  })

  it('off removes the bed with a remux and tells the page the video changed', async () => {
    const t = makeEdit({ project: { bgmEnabled: false, bgmPrompt: 'old', bgmTrackName: 'Old' } })
    const r = await t.svc.callTool('s1', 'set_music', { enabled: false })
    expect(t.longTake.updateBgmSettings).toHaveBeenCalledWith('p1', { bgmEnabled: false }, user)
    expect(t.longTake.createBgmVersion).not.toHaveBeenCalled()
    expect(t.sessions.emitAutonomousEvent).toHaveBeenCalledWith('s1', {
      projectId: 'p1',
      type: 'video_rendered',
    })
    expect(r).toEqual({
      success: true,
      text: JSON.stringify({
        bgmEnabled: false,
        prompt: 'old',
        trackName: 'Old',
        volume: BGM_DEFAULT_VOLUME,
      }),
    })
  })

  it('a prompt makes a new bed from it, word for word', async () => {
    const t = makeEdit({
      project: {
        bgmBedUri: 'store://old.mp3',
        bgmEnabled: true,
        bgmPrompt: 'warm piano',
        bgmTrackName: 'Warm Keys',
      },
    })
    const r = await t.svc.callTool('s1', 'set_music', { enabled: true, prompt: 'warm piano' })
    expect(t.longTake.createBgmVersion).toHaveBeenCalledWith('p1', { prompt: 'warm piano' }, user)
    expect(t.longTake.updateBgmSettings).not.toHaveBeenCalled()
    expect(r).toEqual({
      success: true,
      text: JSON.stringify({
        bgmEnabled: true,
        prompt: 'warm piano',
        trackName: 'Warm Keys',
        volume: BGM_DEFAULT_VOLUME,
      }),
    })
  })

  it('on without a prompt puts an existing bed back, or makes one when there is none', async () => {
    const withBed = makeEdit({ project: { bgmBedUri: 'store://bed.mp3', bgmEnabled: true } })
    await withBed.svc.callTool('s1', 'set_music', { enabled: true })
    expect(withBed.longTake.updateBgmSettings).toHaveBeenCalledWith(
      'p1',
      { bgmEnabled: true },
      user,
    )
    expect(withBed.longTake.createBgmVersion).not.toHaveBeenCalled()

    const noBed = makeEdit({ project: { bgmEnabled: true } })
    await noBed.svc.callTool('s1', 'set_music', { enabled: true })
    expect(noBed.longTake.createBgmVersion).toHaveBeenCalledWith('p1', {}, user)
    expect(noBed.longTake.updateBgmSettings).not.toHaveBeenCalled()
  })

  it('answers "No finished video yet." when the remux finds no delivered video', async () => {
    const t = makeEdit({ remux: { remux: 'skipped_not_delivered' } })
    expect(await t.svc.callTool('s1', 'set_music', { enabled: false })).toEqual({
      success: false,
      text: 'No finished video yet.',
    })
    expect(t.sessions.emitAutonomousEvent).not.toHaveBeenCalled()
  })

  it('refuses a second change while one runs, and Stop cancels the running one', async () => {
    const t = makeEdit({ waits: { 'wf-m': new Promise(() => undefined) } })
    const first = t.svc.callTool('s1', 'set_music', { enabled: false })
    await new Promise((r) => setTimeout(r, 20))
    expect(await t.svc.callTool('s1', 'set_music', { enabled: true })).toEqual({
      success: false,
      text: 'The music is already being changed; wait for it.',
    })
    t.sessions.isFlowCancelled.mockReturnValue(true)
    expect(await first).toEqual({ success: false, text: 'Stopped.' })
    expect(t.cancelled).toEqual(['wf-m'])
  })

  it('reports a failed workflow as text', async () => {
    const failed = Promise.reject(new Error('remux exploded'))
    failed.catch(() => undefined) // created before anyone awaits it: not an unhandled rejection
    const t = makeEdit({ waits: { 'wf-m': failed } })
    expect(await t.svc.callTool('s1', 'set_music', { enabled: false })).toEqual({
      success: false,
      text: 'Failed: remux exploded',
    })
  })
})

describe('tracks by title', () => {
  const user = { sub: 'u', userId: 'u' }
  const script =
    'Look up tonight. A comet is passing by, and it will not be back for seventy years. Step outside, find the darkest patch of sky, and give your eyes ten minutes to adjust.'

  it('make_video with a track title picks that track', async () => {
    const t = makeEdit({ session: { mode: 'free', projectId: null } })
    await t.svc.callTool('s1', 'make_video', { music: 'my brand theme', script, title: 't' })
    expect(t.autonomous.requestStyle).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ music: { choice: 'auto', track: { id: 't1', source: 'upload' } } }),
    )
  })

  it('set_music with a track fits it: the version is created from the track, no prompt', async () => {
    const t = makeEdit({ project: { bgmBedUri: 'store://old.mp3', bgmEnabled: true } })
    const r = await t.svc.callTool('s1', 'set_music', { enabled: true, track: 'Bright Steps' })
    expect(t.longTake.createBgmVersion).toHaveBeenCalledWith(
      'p1',
      { track: { id: 'bright-steps', source: 'library' } },
      user,
    )
    expect(t.longTake.updateBgmSettings).not.toHaveBeenCalled()
    expect(r.success).toBe(true)
  })

  it('answers with the titles on no match', async () => {
    const t = makeEdit({ project: { bgmBedUri: 'store://old.mp3', bgmEnabled: true } })
    const r = await t.svc.callTool('s1', 'set_music', { enabled: true, track: 'Jazz Hands' })
    expect(r).toEqual({
      success: false,
      text: 'No track called "Jazz Hands". Library: Bright Steps. Your tracks: Brand theme.',
    })
    expect(t.longTake.createBgmVersion).not.toHaveBeenCalled()
    expect(t.longTake.updateBgmSettings).not.toHaveBeenCalled()
  })
})

describe('set_music volume', () => {
  const user = { sub: 'u', userId: 'u' }

  it('changes only the level with a remux', async () => {
    const t = makeEdit({ project: { bgmBedUri: 'store://bed.mp3', bgmEnabled: true } })
    const r = await t.svc.callTool('s1', 'set_music', { enabled: true, volume: 60 })
    expect(t.longTake.updateBgmSettings).toHaveBeenCalledWith('p1', { bgmVolume: 60 }, user)
    expect(t.longTake.createBgmVersion).not.toHaveBeenCalled()
    expect(r.success).toBe(true)
  })

  it('with a new track, puts the track in first and then sets the level', async () => {
    const t = makeEdit({ project: { bgmBedUri: 'store://bed.mp3', bgmEnabled: true } })
    await t.svc.callTool('s1', 'set_music', { enabled: true, track: 'Bright Steps', volume: 70 })
    const version = t.longTake.createBgmVersion.mock.invocationCallOrder[0]
    const level = t.longTake.updateBgmSettings.mock.invocationCallOrder[0]
    expect(version).toBeLessThan(level)
    expect(t.longTake.updateBgmSettings).toHaveBeenCalledWith('p1', { bgmVolume: 70 }, user)
  })

  it('refuses a level outside 0-100 and changes nothing', async () => {
    const t = makeEdit({ project: { bgmBedUri: 'store://bed.mp3', bgmEnabled: true } })
    const r = await t.svc.callTool('s1', 'set_music', { enabled: true, volume: 140 })
    expect(r).toEqual({ success: false, text: 'volume must be a whole number from 0 to 100.' })
    expect(t.longTake.updateBgmSettings).not.toHaveBeenCalled()
  })
})

describe('set_music volume, relative and partial', () => {
  const user = { sub: 'u', userId: 'u' }

  it('volume_change moves the level from where it is', async () => {
    const t = makeEdit({
      project: { bgmBedUri: 'store://bed.mp3', bgmEnabled: true, bgmVolume: 80 },
    })
    await t.svc.callTool('s1', 'set_music', { enabled: true, volume_change: -15 })
    expect(t.longTake.updateBgmSettings).toHaveBeenCalledWith('p1', { bgmVolume: 65 }, user)
  })

  it('volume_change starts from the default when no level was saved, and stays in range', async () => {
    const t = makeEdit({ project: { bgmBedUri: 'store://bed.mp3', bgmEnabled: true } })
    await t.svc.callTool('s1', 'set_music', { enabled: true, volume_change: 50 })
    expect(BGM_DEFAULT_VOLUME + 50).toBeGreaterThan(100)
    expect(t.longTake.updateBgmSettings).toHaveBeenCalledWith('p1', { bgmVolume: 100 }, user)
  })

  it('off with a volume keeps the volume for later', async () => {
    const t = makeEdit({ project: { bgmBedUri: 'store://bed.mp3', bgmEnabled: true } })
    await t.svc.callTool('s1', 'set_music', { enabled: false, volume: 40 })
    expect(t.longTake.updateBgmSettings).toHaveBeenCalledWith(
      'p1',
      { bgmEnabled: false, bgmVolume: 40 },
      user,
    )
  })

  it('a stop during the volume step still tells the page the new track is on', async () => {
    const t = makeEdit({
      project: { bgmBedUri: 'store://bed.mp3', bgmEnabled: true },
      remux: { remux: 'started', workflowId: 'wf-v' },
      waits: { 'wf-v': new Promise(() => undefined) },
    })
    const call = t.svc.callTool('s1', 'set_music', {
      enabled: true,
      track: 'Bright Steps',
      volume: 70,
    })
    await new Promise((r) => setTimeout(r, 30))
    t.sessions.isFlowCancelled.mockReturnValue(true)
    const r = await call
    expect(r.success).toBe(false)
    expect(r.text).toMatch(/new music is on/i)
    expect(t.sessions.emitAutonomousEvent).toHaveBeenCalledWith('s1', {
      projectId: 'p1',
      type: 'video_rendered',
    })
  })
})

describe('make_beat_loop', () => {
  const storyboard = JSON.stringify({ clips: [], duration_s: 16, title: 'Pyramids' })

  it('hands the storyboard, title and voice to the loop start and answers with its reply', async () => {
    const t = makeEdit({ session: { mode: 'free', projectId: null } })
    const r = await t.svc.callTool('s1', 'make_beat_loop', {
      storyboard,
      title: ' Pyramid time ',
      voice: ' Rachel ',
    })
    expect(t.autonomous.makeBeatLoop).toHaveBeenCalledWith('s1', {
      storyboard,
      title: 'Pyramid time',
      voice: 'Rachel',
    })
    expect(r.success).toBe(true)
    expect(JSON.parse(r.text)).toEqual({
      clipUsd: 0.16,
      clips: 4,
      durationSeconds: 16,
      estimatedCostUsd: 0.8,
      format: 'beat_loop',
      status: 'waiting_for_make_it',
      warnings: [],
    })
    expect(t.sessions.clearFlowCancelled).toHaveBeenCalledWith('s1')
  })

  it('leaves the voice out when none is named', async () => {
    const t = makeEdit({ session: { mode: 'free', projectId: null } })
    await t.svc.callTool('s1', 'make_beat_loop', { storyboard, title: 'Pyramid time' })
    expect(t.autonomous.makeBeatLoop).toHaveBeenCalledWith('s1', {
      storyboard,
      title: 'Pyramid time',
    })
  })

  it('answers every storyboard issue as a failed call, so the agent fixes them all at once', async () => {
    const invalid = {
      format: 'beat_loop',
      issues: ['clips.0.hit_camera: must be one of Push in, Shake, Zoom in', 'duration_s: 16-32'],
      status: 'invalid',
      warnings: [],
    }
    const t = makeEdit({ makeLoop: invalid, session: { mode: 'free', projectId: null } })
    const r = await t.svc.callTool('s1', 'make_beat_loop', { storyboard, title: 't' })
    expect(r).toEqual({ success: false, text: JSON.stringify(invalid) })
  })

  it('refuses without a storyboard, and in a chat that already made a video', async () => {
    const t = makeEdit({ session: { mode: 'free', projectId: null } })
    expect(await t.svc.callTool('s1', 'make_beat_loop', { storyboard: '  ', title: 't' })).toEqual({
      success: false,
      text: 'storyboard is required: the whole storyboard as one JSON string.',
    })
    const made = makeEdit({ session: { mode: 'free' } })
    expect(await made.svc.callTool('s1', 'make_beat_loop', { storyboard, title: 't' })).toEqual({
      success: false,
      text: 'This chat already made a video; use regenerate_clip to change it.',
    })
    expect(t.autonomous.makeBeatLoop).not.toHaveBeenCalled()
    expect(made.autonomous.makeBeatLoop).not.toHaveBeenCalled()
  })

  it('reports a start that cannot be priced (no loop model) as text', async () => {
    const t = makeEdit({ session: { mode: 'free', projectId: null } })
    t.autonomous.makeBeatLoop.mockImplementation(() => {
      throw new Error('No model can make loop clips')
    })
    expect(await t.svc.callTool('s1', 'make_beat_loop', { storyboard, title: 't' })).toEqual({
      success: false,
      text: 'No model can make loop clips',
    })
  })

  it("answers a voice that can't say the lines with the reason, as a failed call", async () => {
    const t = makeEdit({ session: { mode: 'free', projectId: null } })
    t.autonomous.makeBeatLoop.mockRejectedValue(
      new Error("Couldn't say the narration lines to check they fit their clips: HTTP 500."),
    )
    expect(await t.svc.callTool('s1', 'make_beat_loop', { storyboard, title: 't' })).toEqual({
      success: false,
      text: "Couldn't say the narration lines to check they fit their clips: HTTP 500.",
    })
  })

  it('answers lines too long for their clip as a failed call, each with what to aim for', async () => {
    const tooLong = {
      format: 'beat_loop',
      issues: [
        'clips[1].narration (s2): takes 4.9 s to say with Kokoro Heart and would need 1.42x speed; at most 1.3x fits the 3.45 s a line has. Aim for about 8 short words.',
      ],
      status: 'invalid',
      tooLong: [
        {
          clipId: 's2',
          narration: 'Bees fan the nectar with their wings to dry it.',
          speedNeeded: 1.42,
          spokenSeconds: 4.9,
          target: 'about 8 short words',
        },
      ],
      voice: { free: true, id: 'kokoro-af_heart', name: 'Kokoro Heart' },
      warnings: [],
    }
    const t = makeEdit({ makeLoop: tooLong, session: { mode: 'free', projectId: null } })
    const r = await t.svc.callTool('s1', 'make_beat_loop', { storyboard, title: 't' })
    expect(r).toEqual({ success: false, text: JSON.stringify(tooLong) })
  })
})

describe('regenerate_clip on a loop short', () => {
  const user = { sub: 'u', userId: 'u' }

  it('redoes the clip from its slots, keeps the clips after it, and quotes their cost', async () => {
    const t = makeEdit({ loop: true })
    const r = await t.svc.callTool('s1', 'regenerate_clip', { transitionId: ' s2 ' })
    expect(t.longTake.regenerateLoopClip).toHaveBeenCalledWith(
      'p1',
      's2',
      { redoFollowing: false },
      user,
    )
    expect(t.longTake.regenerateTransitionFromState).not.toHaveBeenCalled()
    expect(r.success).toBe(true)
    const reply = JSON.parse(r.text)
    expect(reply).toMatchObject({
      clipId: 's2',
      clipUsd: 0.16,
      clipsMade: ['s2'],
      estimatedCostUsd: 0.16,
      keptAfter: ['s3', 's4'],
      redoFollowing: false,
      videoPath: 'project/final_video.mp4',
    })
    expect(reply.note).toBe(
      'Clips s3, s4 after it were kept as they were, so the cut from s2 into s3 may jump a little. Making them again too costs about $0.16 a clip ($0.32): call regenerate_clip on s3 with redoFollowing true. The video was rebuilt; no render_video needed.',
    )
    // The loop's own run rebuilds the video: the page plays the new one.
    expect(t.sessions.emitAutonomousEvent).toHaveBeenCalledWith('s1', {
      projectId: 'p1',
      type: 'video_rendered',
    })
  })

  it('with redoFollowing makes every clip after it again, at the cost of each', async () => {
    const t = makeEdit({ loop: true })
    const r = await t.svc.callTool('s1', 'regenerate_clip', {
      redoFollowing: true,
      transitionId: 's2',
    })
    expect(t.longTake.regenerateLoopClip).toHaveBeenCalledWith(
      'p1',
      's2',
      { redoFollowing: true },
      user,
    )
    const reply = JSON.parse(r.text)
    expect(reply).toMatchObject({
      clipsMade: ['s2', 's3', 's4'],
      estimatedCostUsd: 0.48,
      keptAfter: [],
      redoFollowing: true,
    })
    expect(reply.note).toBe('The video was rebuilt; no render_video needed.')
  })

  it('names the clip to redo for the kept ones, and counts the clips after them it makes too', async () => {
    // Clips s1-s5: s3 kept after s2; s4 was missing, so this run made s4 and s5 as well.
    const one = makeEdit({
      loop: true,
      loopRedo: async (clipId) => ({
        clipIds: [clipId, 's4', 's5'],
        clipUsd: 0.16,
        estimatedCostUsd: 0.48,
        followingClipIds: ['s3', 's4', 's5'],
        projectId: 'p1',
        redoFollowing: false,
        workflowId: 'ao:p1:story-mode',
      }),
    })
    const reply = JSON.parse(
      (await one.svc.callTool('s1', 'regenerate_clip', { transitionId: 's2' })).text,
    )
    expect(reply.keptAfter).toEqual(['s3'])
    // Redoing s3 with redoFollowing makes s3, s4 and s5 again: three clips, not one.
    expect(reply.note).toBe(
      'Clip s3 after it was kept as it was, so the cut from s2 into s3 may jump a little. Making it again too, with the 2 clips after it, costs about $0.16 a clip ($0.48): call regenerate_clip on s3 with redoFollowing true. The video was rebuilt; no render_video needed.',
    )

    const single = makeEdit({
      loop: true,
      loopRedo: async (clipId) => ({
        clipIds: [clipId],
        clipUsd: 0.16,
        estimatedCostUsd: 0.16,
        followingClipIds: ['s4'],
        projectId: 'p1',
        redoFollowing: false,
        workflowId: 'ao:p1:story-mode',
      }),
    })
    const note = JSON.parse(
      (await single.svc.callTool('s1', 'regenerate_clip', { transitionId: 's3' })).text,
    ).note
    expect(note).toBe(
      'Clip s4 after it was kept as it was, so the cut from s3 into s4 may jump a little. Making it again too costs about $0.16: call regenerate_clip on s4 with redoFollowing true. The video was rebuilt; no render_video needed.',
    )
  })

  it("answers a failed run with the run's own reason, so the agent can fix it and try again", async () => {
    // The engine wraps the workflow's failure: WorkflowFailedError > ActivityFailure > the reason.
    const reason = ApplicationFailure.nonRetryable(
      'Clip s2 failed its checks on every take, so the loop stopped before making the other clips.',
    )
    const activity = new ActivityFailure(
      'Activity task failed',
      'beatLoopMakeClip',
      '7',
      'NON_RETRYABLE_FAILURE',
      reason,
    )
    const failed = new WorkflowFailedError('Workflow execution failed', activity)
    const t = makeEdit({ loop: true, waits: { 'ao:p1:story-mode': Promise.reject(failed) } })
    expect(await t.svc.callTool('s1', 'regenerate_clip', { transitionId: 's2' })).toEqual({
      success: false,
      text: `Failed: ${reason.message}`,
    })
    expect(t.cancelled).toEqual([])
    expect(t.sessions.emitAutonomousEvent).not.toHaveBeenCalled()
  })

  it('holds the project while the redo starts, so a render in between is refused', async () => {
    let release: () => void = () => undefined
    const t = makeEdit({
      loop: true,
      loopRedo: (clipId) =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              clipIds: [clipId],
              clipUsd: 0.16,
              estimatedCostUsd: 0.16,
              followingClipIds: [],
              projectId: 'p1',
              redoFollowing: false,
              workflowId: 'ao:p1:story-mode',
            })
        }),
    })
    const first = t.svc.callTool('s1', 'regenerate_clip', { transitionId: 's2' })
    await new Promise((r) => setTimeout(r, 20))
    expect(await t.svc.callTool('s1', 'render_video', {})).toEqual({
      success: false,
      text: 'A clip is already being redone; wait for it.',
    })
    expect(t.longTake.renderFromState).not.toHaveBeenCalled()
    release()
    expect((await first).success).toBe(true)
    // Once the redo is done, the project is free again.
    expect((await t.svc.callTool('s1', 'render_video', {})).success).toBe(true)
  })

  it('frees the project when the redo cannot start', async () => {
    const t = makeEdit({
      loop: true,
      loopRedo: async () => {
        throw new Error('No clip s9. Clips: s1, s2, s3, s4.')
      },
    })
    await t.svc.callTool('s1', 'regenerate_clip', { transitionId: 's9' })
    expect((await t.svc.callTool('s1', 'render_video', {})).success).toBe(true)
  })

  it('passes new slots from the changes JSON, and refuses changes it cannot apply', async () => {
    const t = makeEdit({ loop: true })
    await t.svc.callTool('s1', 'regenerate_clip', {
      changes: JSON.stringify({ hit: 'The pyramid splits open', hit_camera: 'Shake' }),
      transitionId: 's2',
    })
    expect(t.longTake.regenerateLoopClip).toHaveBeenCalledWith(
      'p1',
      's2',
      { changes: { hit: 'The pyramid splits open', hit_camera: 'Shake' }, redoFollowing: false },
      user,
    )

    const bad = makeEdit({ loop: true })
    const notAnObject = {
      success: false,
      text: 'changes must be a JSON object of the clip\'s new slots, e.g. {"hit": "..."}.',
    }
    expect(
      await bad.svc.callTool('s1', 'regenerate_clip', { changes: '{hit:', transitionId: 's2' }),
    ).toEqual(notAnObject)
    expect(
      await bad.svc.callTool('s1', 'regenerate_clip', { changes: '[1]', transitionId: 's2' }),
    ).toEqual(notAnObject)
    expect(
      await bad.svc.callTool('s1', 'regenerate_clip', {
        changes: JSON.stringify({ id: 's9', prompt: 'x' }),
        transitionId: 's2',
      }),
    ).toEqual({
      success: false,
      text: 'changes can only rewrite caption, cut, cut_camera, freeze, hit, hit_camera, narration, stamp (not id, prompt).',
    })
    expect(bad.longTake.regenerateLoopClip).not.toHaveBeenCalled()
  })

  it('refuses a prompt: a loop clip is made from its storyboard slots', async () => {
    const t = makeEdit({ loop: true })
    expect(
      await t.svc.callTool('s1', 'regenerate_clip', { prompt: 'a new move', transitionId: 's2' }),
    ).toEqual({
      success: false,
      text: "This video is a loop short: its clips are made from their storyboard slots. Leave out prompt, and pass changes to rewrite the clip's slots.",
    })
    expect(t.longTake.regenerateLoopClip).not.toHaveBeenCalled()
  })

  it('answers the loop service refusals as text (unknown clip, a run still going)', async () => {
    const t = makeEdit({
      loop: true,
      loopRedo: async () => {
        throw new Error('No clip s9. Clips: s1, s2, s3, s4.')
      },
    })
    expect(await t.svc.callTool('s1', 'regenerate_clip', { transitionId: 's9' })).toEqual({
      success: false,
      text: 'No clip s9. Clips: s1, s2, s3, s4.',
    })
    expect(t.waitForWorkflow).not.toHaveBeenCalled()
  })

  it('runs on a loop whose last run failed, as the loop service picks up from its kept clips', async () => {
    const t = makeEdit({ loop: true, status: { stage: 'failed', videoUrl: null } })
    const r = await t.svc.callTool('s1', 'regenerate_clip', { transitionId: 's2' })
    expect(r.success).toBe(true)
    expect(t.longTake.regenerateLoopClip).toHaveBeenCalled()
  })

  it('names the clips the run kept although they still fail a check', async () => {
    const t = makeEdit({
      loop: true,
      waits: {
        'ao:p1:story-mode': {
          flaggedClips: [{ clipId: 's2', failures: ['It cuts away before 3 s.'] }],
          rerolls: 1,
          resumedClips: 3,
          status: 'completed',
        },
      },
    })
    const r = await t.svc.callTool('s1', 'regenerate_clip', { transitionId: 's2' })
    expect(JSON.parse(r.text).flaggedClips).toEqual([
      { clipId: 's2', failures: ['It cuts away before 3 s.'] },
    ])
  })

  it('names the clips made on the other provider because the first model failed on them', async () => {
    const otherModelClips = [
      { clipId: 's2', failedModel: 'MiniMax Hailuo 3 Max Turbo', model: 'Gemini Omni Flash' },
    ]
    const t = makeEdit({
      loop: true,
      waits: {
        'ao:p1:story-mode': {
          flaggedClips: [],
          otherModelClips,
          rerolls: 0,
          resumedClips: 3,
          status: 'completed',
        },
      },
    })
    const reply = JSON.parse(
      (await t.svc.callTool('s1', 'regenerate_clip', { transitionId: 's2' })).text,
    )
    expect(reply.otherModelClips).toEqual(otherModelClips)
    expect(reply.note).toMatch(
      /^Clip s2 was made with Gemini Omni Flash: MiniMax Hailuo 3 Max Turbo failed on it, so it cost that model's price\. /,
    )
  })

  it('shows the changed lines and stamps in the Storyboard panel as soon as the redo starts', async () => {
    const t = makeEdit({ loop: true })
    await t.svc.callTool('s1', 'regenerate_clip', {
      changes: JSON.stringify({ stamp: '3,000 YEARS' }),
      transitionId: 's2',
    })
    const events = t.sessions.emitAutonomousEvent.mock.calls.map(([, e]) => e as { type: string })
    expect(events.map((e) => e.type)).toEqual(['brief', 'video_rendered'])
    expect(events[0]).toEqual({
      brief: '4 clips of 4 s, replaying as a loop',
      durationSeconds: 16,
      lines: LOOP_STORYBOARD.clips.map(({ narration, stamp }) => ({ narration, stamp })),
      title: 'Honey keeps',
      type: 'brief',
    })

    // A redo with no changes leaves the panel's lines as they are.
    const same = makeEdit({ loop: true })
    await same.svc.callTool('s1', 'regenerate_clip', { transitionId: 's2' })
    expect(same.sessions.emitAutonomousEvent.mock.calls.map(([, e]) => e.type)).toEqual([
      'video_rendered',
    ])
  })

  it('keeps the clip when only its words change: no clip made, and says how to make it again', async () => {
    const t = makeEdit({
      loop: true,
      loopRedo: async () => ({
        clipIds: [],
        clipRemade: false,
        clipUsd: 0.16,
        estimatedCostUsd: 0,
        followingClipIds: [],
        projectId: 'p1',
        redoFollowing: false,
        storyboard: LOOP_STORYBOARD,
        workflowId: 'ao:p1:story-mode',
      }),
    })
    const r = await t.svc.callTool('s1', 'regenerate_clip', {
      changes: JSON.stringify({ stamp: '3,000 years' }),
      redoFollowing: true,
      transitionId: 's2',
    })
    expect(r.success).toBe(true)
    const reply = JSON.parse(r.text)
    expect(reply).toMatchObject({
      clipKept: true,
      clipsMade: [],
      estimatedCostUsd: 0,
      keptAfter: [],
      redoFollowing: false,
    })
    expect(reply.note).toBe(
      "Only the clip's words changed (narration, caption or stamp), so clip s2 was kept and no clip was paid for: the voice-over, captions and stamps were made again. To make the clip itself again (about $0.16), call regenerate_clip on s2 without changes. The video was rebuilt; no render_video needed.",
    )

    // A stopped run's missing clips are still made, and named.
    const unfinished = makeEdit({
      loop: true,
      loopRedo: async () => ({
        clipIds: ['s3', 's4'],
        clipRemade: false,
        clipUsd: 0.16,
        estimatedCostUsd: 0.32,
        followingClipIds: [],
        projectId: 'p1',
        redoFollowing: false,
        storyboard: LOOP_STORYBOARD,
        workflowId: 'ao:p1:story-mode',
      }),
    })
    const note = JSON.parse(
      (
        await unfinished.svc.callTool('s1', 'regenerate_clip', {
          changes: JSON.stringify({ stamp: '3,000 years' }),
          transitionId: 's2',
        })
      ).text,
    ).note
    expect(note).toBe(
      "Only the clip's words changed (narration, caption or stamp), so clip s2 was kept: the voice-over, captions and stamps were made again. Clips s3, s4 had never been made, so the run made them (about $0.32). To make clip s2 itself again (about $0.16), call regenerate_clip on s2 without changes. The video was rebuilt; no render_video needed.",
    )
  })

  it('waits longer when it makes more clips, and a stop cancels the loop run', async () => {
    const t = makeEdit({ loop: true })
    await t.svc.callTool('s1', 'regenerate_clip', { transitionId: 's2' })
    await t.svc.callTool('s1', 'regenerate_clip', { redoFollowing: true, transitionId: 's2' })
    const [one, three] = t.waitForWorkflow.mock.calls.map((call) => call[1])
    expect(one).toBeGreaterThanOrEqual(10 * 60 * 1000)
    expect(three).toBeGreaterThan(one)

    const stopped = makeEdit({
      loop: true,
      waits: { 'ao:p1:story-mode': new Promise(() => undefined) },
    })
    stopped.sessions.isFlowCancelled.mockReturnValue(true)
    expect(await stopped.svc.callTool('s1', 'regenerate_clip', { transitionId: 's2' })).toEqual({
      success: false,
      text: 'Stopped.',
    })
    expect(stopped.cancelled).toEqual(['ao:p1:story-mode'])
    expect(stopped.sessions.emitAutonomousEvent).not.toHaveBeenCalled()
  })

  it('refuses while another edit runs on the project, before any clip is set aside', async () => {
    const t = makeEdit({ loop: true, waits: { 'ao:p1:story-mode': new Promise(() => undefined) } })
    const first = t.svc.callTool('s1', 'regenerate_clip', { transitionId: 's2' })
    await new Promise((r) => setTimeout(r, 20))
    const busy = { success: false, text: 'A clip is already being redone; wait for it.' }
    expect(await t.svc.callTool('s1', 'regenerate_clip', { transitionId: 's3' })).toEqual(busy)
    expect(await t.svc.callTool('s1', 'render_video', {})).toEqual(busy)
    expect(t.longTake.regenerateLoopClip).toHaveBeenCalledTimes(1)
    t.sessions.isFlowCancelled.mockReturnValue(true)
    await first
  })

  it('refuses a redoFollowing that is not true or false', async () => {
    const t = makeEdit({ loop: true })
    expect(
      await t.svc.callTool('s1', 'regenerate_clip', { redoFollowing: 'yes', transitionId: 's2' }),
    ).toEqual({ success: false, text: 'redoFollowing must be true or false.' })
    expect(t.longTake.regenerateLoopClip).not.toHaveBeenCalled()
  })

  it('keeps the story video path: a prompt is still required there', async () => {
    const t = makeEdit()
    expect(await t.svc.callTool('s1', 'regenerate_clip', { transitionId: 'transition_0' })).toEqual(
      { success: false, text: 'prompt is required.' },
    )
    expect(t.longTake.regenerateLoopClip).not.toHaveBeenCalled()
  })
})

describe('set_music on a loop short', () => {
  it('adds music like on any video: the loop keeps its own sound under it', async () => {
    const t = makeEdit({ loop: true, project: { bgmEnabled: false } })
    const r = await t.svc.callTool('s1', 'set_music', { enabled: true })
    expect(r.success).toBe(true)
    expect(t.longTake.createBgmVersion).toHaveBeenCalledTimes(1)
    expect(t.sessions.emitAutonomousEvent).toHaveBeenCalledWith('s1', {
      projectId: 'p1',
      type: 'video_rendered',
    })
  })
})
