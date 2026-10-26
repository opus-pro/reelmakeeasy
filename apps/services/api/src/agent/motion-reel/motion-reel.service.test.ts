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
  const SCORE = {
    bpm: 128,
    groove: 'four',
    hits: [{ bar: 3, beat: 1, kind: 'hit' }],
    key: 'D',
    mode: 'minor',
    sections: [
      { bars: 2, energy: 1, name: 'intro' },
      { bars: 5, energy: 3, name: 'drop' },
    ],
  }

  it("renders a score written in code, its grid exactly the score's, the reel ending on its final hit", async () => {
    const { service, updated } = await setUp()
    // 15 s at 128 BPM is 8 bars: the score fills 7, the last holds the final hit.
    const result = await service.callTool('s1', 'motion_music', { score: JSON.stringify(SCORE) })
    expect(result.success).toBe(true)
    expect(result.text).toMatch(/Rendered your score/)
    const music = jest.mocked(prepareReelProject).mock.calls[0]?.[0].music
    expect(music?.file).toMatch(/music\/score-\d+\.wav$/)
    expect(fs.existsSync(music?.file ?? '')).toBe(true)
    expect(music?.grid).toMatchObject({ beatsPerBar: 4, bpm: 128 })
    expect(music?.grid?.downbeats.slice(0, 3)).toEqual([0, 1.875, 3.75])
    expect(music?.grid?.strongHits[0]).toBe(13.125)
    expect(updated.at(-1)?.musicTitle).toBe('Score: D minor, 128 BPM')
    expect(composeMusic).not.toHaveBeenCalled()
  }, 60000)

  it('says how many bars the score needs when it is off', async () => {
    const { service } = await setUp()
    const result = await service.callTool('s1', 'motion_music', {
      engine: 'code',
      score: JSON.stringify({ ...SCORE, sections: [{ bars: 4, energy: 2, name: 'groove' }] }),
    })
    expect(result).toEqual({
      success: false,
      text: expect.stringMatching(/add up to 4 bars; at 128 BPM they must add up to 7/),
    })
  })

  it('composes with the music model the user picked', async () => {
    const { service, updated } = await setUp({ music: 'agent', musicEngine: 'eleven-music' })
    const result = await service.callTool('s1', 'motion_music', { prompt: 'a bright launch track' })
    expect(result.success).toBe(true)
    expect(jest.mocked(composeMusic).mock.calls[0]?.[3]).toBe('eleven-music')
    expect(updated.at(-1)?.musicTitle).toMatch(/^ElevenLabs Music: a bright launch track/)
    expect(await service.callTool('s1', 'motion_music', { engine: 'kazoo', prompt: 'x' })).toEqual({
      success: false,
      text: 'engine is code, eleven-music or ace-step.',
    })
  })

  it("keeps a score through a new frame, but not through a new length (its bars are the reel's)", async () => {
    const { service } = await setUp()
    await service.callTool('s1', 'motion_music', { score: JSON.stringify(SCORE) })
    jest.mocked(prepareReelProject).mockClear()
    await service.callTool('s1', 'motion_setup', { ...ARGS, music: 'agent', ratio: '1:1' })
    expect(jest.mocked(prepareReelProject).mock.calls[0]?.[0].music?.grid?.bpm).toBe(128)
    jest.mocked(prepareReelProject).mockClear()
    const longer = await service.callTool('s1', 'motion_setup', {
      ...ARGS,
      lengthSec: 30,
      music: 'agent',
    })
    expect(jest.mocked(prepareReelProject).mock.calls[0]?.[0].music).toBeNull()
    expect(longer.text).toMatch(/write it as a score with motion_music/)
  }, 60000)
})
