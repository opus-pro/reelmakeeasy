import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { AgentMotionSetupView, AgentSession } from '@shared/types/api/agent'

import { composeMusic } from './motion-music'
import { prepareReelProject } from './motion-project'
import { MotionReelService, type MotionReelSessions } from './motion-reel.service'

// Setting a reel up installs Remotion and decodes music: both stand-ins here.
jest.mock('./motion-runtime', () => ({
  ensureMotionReelRuntime: jest.fn(async (say: (line: string) => void) =>
    say('Remotion is ready.'),
  ),
}))
jest.mock('./motion-project', () => ({
  ...jest.requireActual('./motion-project'),
  prepareReelProject: jest.fn(async (o: { workspace: string }) => {
    const projectDir = path.join(o.workspace, 'reel')
    fs.mkdirSync(projectDir, { recursive: true })
    fs.writeFileSync(path.join(projectDir, 'brief.md'), '# Brief\n')
    return {
      grid: null,
      projectDir,
      reel: { bars: 8, beatsPerBar: 4, beats: [], bpm: 128, lengthSec: 15, strongHits: [] },
    }
  }),
}))
jest.mock('./motion-render', () => ({
  ...jest.requireActual('./motion-render'),
  typeCheck: jest.fn(async () => null),
}))
jest.mock('./motion-music', () => ({
  ...jest.requireActual('./motion-music'),
  composeMusic: jest.fn(async (_request: unknown, _sec: number, dir: string, key?: string) => {
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `composed-${Date.now()}.mp3`)
    fs.writeFileSync(file, 'mp3')
    return { file, model: key ?? 'role' }
  }),
}))
jest.mock('./motion-reference', () => ({
  ...jest.requireActual('./motion-reference'),
  readReference: jest.fn(async () => 'site-1.png to site-3.png and brand.json'),
}))

const ARGS = {
  lengthSec: 15,
  music: 'library',
  musicId: 'pulse-drive',
  ratio: '16:9',
  styleId: 'hud-showreel',
  subject: 'ReelMakeEasy: make videos on your own computer',
}

function setup(mode: AgentSession['mode'], userTexts: string[] = []) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-svc-'))
  let session: AgentSession = {
    createdAt: '',
    id: 's1',
    mode,
    projectId: null,
    status: 'running',
    threadId: null,
    title: 'x',
  }
  const messages: string[] = []
  const updated: AgentMotionSetupView[] = []
  const sessions: MotionReelSessions = {
    attachmentsDir: () => path.join(workspace, 'attachments'),
    emitAutonomousEvent: jest.fn(),
    emitImage: jest.fn(),
    emitMessage: (_id, text) => messages.push(text),
    emitNotice: (_id, text) => messages.push(`notice: ${text}`),
    getSession: () => session,
    setFlowWorking: jest.fn(),
    startMotionReel: jest.fn(),
    updateMotionReel: (_id, view) => {
      updated.push(view)
      session = { ...session, motionReel: view }
    },
    userTexts: () => userTexts,
    workingDir: () => workspace,
  }
  return { messages, service: new MotionReelService(sessions), sessions, updated, workspace }
}

describe('MotionReelService, an Advanced chat', () => {
  it('lists the styles, lengths, frames and tracks when motion_setup names no style', async () => {
    const { service, updated } = setup('motion_free')
    const result = await service.callTool('s1', 'motion_setup', {})
    expect(result.success).toBe(true)
    expect(result.text).toMatch(/- hud-showreel: HUD Showreel/)
    expect(result.text).toMatch(/Lengths \(lengthSec\): 10, 15, 30, 60/)
    expect(result.text).toMatch(/- pulse-drive: Pulse Drive, \d+ BPM/)
    expect(updated).toEqual([])
  })

  it('readies the reel, shows the setup in the chat and says what to read next', async () => {
    const { messages, service, updated } = setup('motion_free', [
      'Use the look of https://reelmakeeasy.example',
    ])
    const result = await service.callTool('s1', 'motion_setup', {
      ...ARGS,
      referenceUrl: 'https://reelmakeeasy.example',
    })
    expect(result.success).toBe(true)
    expect(result.text).toMatch(
      /^`reel\/` is ready: HUD Showreel, 16:9, 15 s \(8 bars at 128 BPM\), music: Pulse Drive/,
    )
    expect(result.text).toMatch(/Read `reel\/brief.md`.*reel\/public\/reference/)
    expect(result.text).toMatch(/write `reel\/plan.md`/)
    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({ bars: 8, bpm: 128, reelSec: 15, styleLabel: 'HUD Showreel' })
    expect(messages).toContain('Remotion is ready.')

    // Again (the user changed the length): set up anew, the scenes kept.
    const again = await service.callTool('s1', 'motion_setup', { ...ARGS, lengthSec: 30 })
    expect(again.text).toMatch(/set up again.*Your scenes and plan were kept/)
    expect(updated).toHaveLength(2)
  })

  it('keeps the music it composed when set up again for a new frame (no new paid track)', async () => {
    const { service, sessions, updated, workspace } = setup('motion_free')
    await service.callTool('s1', 'motion_setup', { ...ARGS, music: 'agent' })
    // motion_music made a track (stand-in) and the setup says so.
    const musicDir = path.join(workspace, 'reel', 'music')
    fs.mkdirSync(musicDir, { recursive: true })
    fs.writeFileSync(path.join(musicDir, 'composed-1.mp3'), 'old')
    fs.writeFileSync(path.join(musicDir, 'composed-2.mp3'), 'newest')
    const view = updated.at(-1) as AgentMotionSetupView
    sessions.updateMotionReel('s1', { ...view, musicTitle: 'Composed: punchy synthwave' })
    jest.mocked(prepareReelProject).mockClear()

    const again = await service.callTool('s1', 'motion_setup', {
      ...ARGS,
      music: 'agent',
      ratio: '9:16',
    })
    expect(jest.mocked(prepareReelProject).mock.calls[0]?.[0].music).toEqual({
      file: path.join(musicDir, 'composed-2.mp3'),
      title: 'Composed: punchy synthwave',
    })
    expect(again.text).toMatch(/music: Composed: punchy synthwave/)
    expect(again.text).toMatch(/The music you made is kept/)
    expect(again.text).not.toMatch(/compose it with motion_music/)
  })

  it("refuses a reference the user didn't paste, and doesn't set anything up", async () => {
    const { service, updated } = setup('motion_free', ['make it look nice'])
    const result = await service.callTool('s1', 'motion_setup', {
      ...ARGS,
      referenceUrl: 'https://elsewhere.example/?d=x',
    })
    expect(result).toEqual({ success: false, text: expect.stringMatching(/pasted in this chat/) })
    expect(updated).toEqual([])
  })

  it('asks for the setup before the other tools', async () => {
    const { service } = setup('motion_free')
    expect(await service.callTool('s1', 'motion_still', { beats: '0' })).toEqual({
      success: false,
      text: 'Set the reel up first: call motion_setup.',
    })
  })

  it('leaves an Easy chat to its setup card', async () => {
    const { service, updated } = setup('motion')
    const result = await service.callTool('s1', 'motion_setup', ARGS)
    expect(result.success).toBe(false)
    expect(result.text).toMatch(/setup card/)
    expect(updated).toEqual([])
  })
})

describe('the music the agent makes', () => {
  async function setUp(music?: Record<string, unknown>) {
    const ctx = setup('motion_free')
    await ctx.service.callTool('s1', 'motion_setup', { ...ARGS, ...(music ?? { music: 'agent' }) })
    jest.mocked(prepareReelProject).mockClear()
    jest.mocked(composeMusic).mockClear()
    return ctx
  }

  it('composes with ElevenLabs Music unless the user picked ACE-Step', async () => {
    const { service, updated } = await setUp()
    const result = await service.callTool('s1', 'motion_music', { prompt: 'a bright launch track' })
    expect(result.success).toBe(true)
    expect(jest.mocked(composeMusic).mock.calls[0]?.[3]).toBe('eleven-music')
    expect(updated.at(-1)?.musicTitle).toMatch(/^ElevenLabs Music: a bright launch track/)
  })

  it('composes with the music model the user picked', async () => {
    const { service, updated } = await setUp({ music: 'agent', musicEngine: 'ace-step' })
    const result = await service.callTool('s1', 'motion_music', { prompt: 'a bright launch track' })
    expect(result.success).toBe(true)
    expect(jest.mocked(composeMusic).mock.calls[0]?.[3]).toBe('ace-step')
    expect(updated.at(-1)?.musicTitle).toMatch(/^ACE-Step: a bright launch track/)
    expect(await service.callTool('s1', 'motion_music', { engine: 'code', prompt: 'x' })).toEqual({
      success: false,
      text: 'engine is eleven-music or ace-step.',
    })
  })

  it('carries on a chat saved when music could be written in code, its score as a plain track', async () => {
    const { service, sessions, updated, workspace } = await setUp()
    const musicDir = path.join(workspace, 'reel', 'music')
    fs.mkdirSync(musicDir, { recursive: true })
    fs.writeFileSync(path.join(musicDir, 'score-1.wav'), 'wav')
    const view = updated.at(-1) as AgentMotionSetupView
    sessions.updateMotionReel('s1', {
      ...view,
      music: { engine: 'code', source: 'agent' } as unknown as AgentMotionSetupView['music'],
      musicTitle: 'Score: D minor, 128 BPM',
    })
    jest.mocked(prepareReelProject).mockClear()

    const again = await service.callTool('s1', 'motion_setup', { ...ARGS, music: 'agent' })
    expect(again.success).toBe(true)
    expect(jest.mocked(prepareReelProject).mock.calls[0]?.[0].music).toEqual({
      file: path.join(musicDir, 'score-1.wav'),
      title: 'Score: D minor, 128 BPM',
    })
    expect(updated.at(-1)?.music).toEqual({ engine: 'eleven-music', source: 'agent' })

    // A new length drops the score (its bars were the old reel's): the agent makes new music.
    sessions.updateMotionReel('s1', {
      ...(updated.at(-1) as AgentMotionSetupView),
      music: { engine: 'code', source: 'agent' } as unknown as AgentMotionSetupView['music'],
    })
    jest.mocked(prepareReelProject).mockClear()
    const longer = await service.callTool('s1', 'motion_setup', {
      ...ARGS,
      lengthSec: 60,
      music: 'agent',
    })
    expect(longer.success).toBe(true)
    expect(longer.text).not.toMatch(/The music you made is kept/)
    expect(jest.mocked(prepareReelProject).mock.calls[0]?.[0].music?.file).not.toBe(
      path.join(musicDir, 'score-1.wav'),
    )

    // Music made anew comes from ElevenLabs Music.
    sessions.updateMotionReel('s1', {
      ...(updated.at(-1) as AgentMotionSetupView),
      music: { engine: 'code', source: 'agent' } as unknown as AgentMotionSetupView['music'],
    })
    const made = await service.callTool('s1', 'motion_music', { prompt: 'a bright launch track' })
    expect(made.success).toBe(true)
    expect(jest.mocked(composeMusic).mock.calls[0]?.[3]).toBe('eleven-music')
    expect(jest.mocked(prepareReelProject).mock.calls.at(-1)?.[0].setup.music).toEqual({
      engine: 'eleven-music',
      source: 'agent',
    })
  })
})
