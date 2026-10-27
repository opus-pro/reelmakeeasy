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
  pulseRefusal: jest.fn(() => null),
  readReelJson: jest.fn(() => ({ bars: 8, bpm: 128, lengthSec: 15 })),
  renderReel: jest.fn(),
  typeCheck: jest.fn(async () => null),
}))
jest.mock('@reelmakeeasy/common/storage/stored-files', () => ({
  ...jest.requireActual('@reelmakeeasy/common/storage/stored-files'),
  uploadToStore: jest.fn(async () => undefined),
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
  type: 'showreel',
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
  it('lists the reel types, lengths, frames and tracks when motion_setup names no type', async () => {
    const { service, updated } = setup('motion_free')
    const result = await service.callTool('s1', 'motion_setup', {})
    expect(result.success).toBe(true)
    expect(result.text).toMatch(
      /- launch: Product launch\. Make one product memorable: show it working\.\n- showreel: Motion reel\. Pure show-off motion that looks super cool\./,
    )
    expect(result.text).not.toMatch(/styleId|Styles/)
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
      /^`reel\/` is ready: Motion reel, 16:9, 15 s \(8 bars at 128 BPM\), music: Pulse Drive/,
    )
    expect(result.text).toMatch(/Read `reel\/brief.md`.*reel\/public\/reference/)
    expect(result.text).toMatch(/write `reel\/plan.md`/)
    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({ bars: 8, bpm: 128, reelSec: 15, typeLabel: 'Motion reel' })
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

  it('motion_review asks for a render first, without type-checking the scenes', async () => {
    const { service } = setup('motion_free')
    await service.callTool('s1', 'motion_setup', ARGS)
    const { typeCheck } = jest.requireMock<{ typeCheck: jest.Mock }>('./motion-render')
    typeCheck.mockClear()
    const result = await service.callTool('s1', 'motion_review', {})
    expect(result.success).toBe(false)
    expect(result.text).toMatch(/^Nothing to review yet: render the reel with motion_render first/)
    expect(typeCheck).not.toHaveBeenCalled()
  })

  it('motion_render sends the agent to motion_review whether the sync check passes or not', async () => {
    const { service } = setup('motion_free')
    await service.callTool('s1', 'motion_setup', ARGS)
    const { renderReel } = jest.requireMock<{ renderReel: jest.Mock }>('./motion-render')
    const rendered = (passes: boolean) => ({
      file: '/tmp/reel.mp4',
      poster: '/tmp/reel.jpg',
      report: '',
      sync: { lines: [passes ? 'Sync: passes.' : 'Sync: 1 to fix: stalls.'], passes },
    })
    renderReel.mockResolvedValueOnce(rendered(true))
    const pass = await service.callTool('s1', 'motion_render', {})
    expect(pass.success).toBe(true)
    expect(pass.text).toMatch(
      /Sync: passes\.\n\nA passing sync check is not the review\. Now call motion_review/,
    )
    renderReel.mockResolvedValueOnce(rendered(false))
    const fail = await service.callTool('s1', 'motion_render', {})
    expect(fail.text).toMatch(
      /Sync: 1 to fix: stalls\.\n\nNow call motion_review, open every sheet and write reel\/review\.md with every miss/,
    )
    expect(fail.text).toMatch(/at most 3 renders, one per review round/)
  })

  it('motion_render refuses a scene that pulses on every kick, snare or note, before rendering', async () => {
    const { service } = setup('motion_free')
    await service.callTool('s1', 'motion_setup', ARGS)
    const mocked = jest.requireMock<{ pulseRefusal: jest.Mock; renderReel: jest.Mock }>(
      './motion-render',
    )
    mocked.renderReel.mockClear()
    mocked.pulseRefusal.mockReturnValueOnce('Not rendered: src/scenes/Clips.tsx:28 (...) pulses')
    const result = await service.callTool('s1', 'motion_render', {})
    expect(result).toEqual({ success: false, text: expect.stringMatching(/^Not rendered: /) })
    expect(mocked.renderReel).not.toHaveBeenCalled()
  })

  it('leaves an Easy chat to its setup card', async () => {
    const { service, updated } = setup('motion')
    const result = await service.callTool('s1', 'motion_setup', ARGS)
    expect(result.success).toBe(false)
    expect(result.text).toMatch(/setup card/)
    expect(updated).toEqual([])
  })
})

/** A real, tiny WAV `seconds` long (100 Hz mono 8-bit silence): the length is what is checked. */
function silentWav(seconds: number): Buffer {
  const data = Buffer.alloc(Math.round(seconds * 100), 128)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(100, 24)
  header.writeUInt32LE(100, 28)
  header.writeUInt16LE(1, 32)
  header.writeUInt16LE(8, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

/** A real composer render's build/music.json (34 bars at 136 BPM, 60 s), trimmed. */
const COMPOSER_JSON = path.join(__dirname, 'fixtures', 'composer-music.json')

/** What the agent's composer run leaves in reel/music/: music.mjs, then its score, music.json and QC. */
function writeComposerRun(workspace: string, o: { fail?: boolean; stale?: boolean } = {}): void {
  const dir = path.join(workspace, 'reel', 'music')
  for (const sub of ['audio', 'build', 'qc']) fs.mkdirSync(path.join(dir, sub), { recursive: true })
  fs.writeFileSync(path.join(dir, 'music.mjs'), 'export default {}\n')
  fs.writeFileSync(path.join(dir, 'audio', 'score.wav'), silentWav(60))
  fs.copyFileSync(COMPOSER_JSON, path.join(dir, 'build', 'music.json'))
  const checks = [
    { id: 'harmony', msg: 'F# dorian: 555 pitched notes, every chord stable', status: 'PASS' },
    { id: 'kick', msg: '41 kick hits, every one tight', status: 'PASS' },
    { id: 'loudness', msg: 'integrated -13.9 LUFS (target -14)', status: 'PASS' },
    { id: 'ending', msg: 'ring: rings out', status: o.fail ? 'FAIL' : 'PASS' },
    { id: 'phone', msg: '200 Hz high-passed (phone speaker) loses 6.4 LU', status: 'WARN' },
  ]
  fs.writeFileSync(path.join(dir, 'qc', 'score-report.json'), JSON.stringify({ checks }))
  const now = Date.now() / 1000
  const [source, made] = o.stale ? [now, now - 60] : [now - 60, now]
  fs.utimesSync(path.join(dir, 'music.mjs'), source, source)
  for (const file of ['audio/score.wav', 'build/music.json', 'qc/score-report.json'])
    fs.utimesSync(path.join(dir, file), made, made)
}

describe('the music the agent makes', () => {
  async function setUp(music?: Record<string, unknown>) {
    const ctx = setup('motion_free')
    await ctx.service.callTool('s1', 'motion_setup', { ...ARGS, ...(music ?? { music: 'agent' }) })
    jest.mocked(prepareReelProject).mockClear()
    jest.mocked(composeMusic).mockClear()
    return ctx
  }

  it("puts the score the agent composed under the reel, its grid and events exactly the score's", async () => {
    const { service, updated, workspace } = await setUp({ lengthSec: 60, music: 'agent' })
    expect(updated.at(-1)?.music).toEqual({ engine: 'composer', source: 'agent' })
    writeComposerRun(workspace)
    const result = await service.callTool('s1', 'motion_music', {})
    expect(result.success).toBe(true)
    expect(result.text).toMatch(/^Composed: F# dorian, 136 BPM\. Put under the reel/)
    expect(result.text).toMatch(
      /QC passed: harmony, kick, loudness, ending\. QC WARN phone: 200 Hz/,
    )
    expect(result.text).toMatch(/never how it sounds/)
    const music = jest.mocked(prepareReelProject).mock.calls[0]?.[0].music
    expect(music?.file).toMatch(/reel[\\/]music[\\/]composer-\d+\.wav$/)
    expect(fs.existsSync(music?.file ?? '')).toBe(true)
    expect(music?.grid).toMatchObject({ beatsPerBar: 4, bpm: 136, durationSec: 60 })
    expect(music?.grid?.downbeats.slice(0, 3)).toEqual([0, 1.765, 3.529])
    expect(music?.grid?.events?.kicks.slice(0, 2)).toEqual([0, 1.765])
    expect(music?.grid?.events?.melody[0]).toEqual({ strength: 1, t: 0 })
    expect(music?.grid?.events?.sections.map((s) => s.name)).toContain('dropB')
    expect(updated.at(-1)?.musicTitle).toBe('Composed: F# dorian, 136 BPM')
    expect(composeMusic).not.toHaveBeenCalled()
  })

  it('says what to do when the score is missing, stale, failed its QC or is the wrong length', async () => {
    const { service, workspace } = await setUp()
    const call = () => service.callTool('s1', 'motion_music', { engine: 'composer' })
    // A reel set up without the composer in reel/music/tools/ (an earlier version) gets it now.
    expect(await call()).toEqual({
      success: false,
      text: expect.stringMatching(
        /^The composer was not in this reel yet: it is now in reel\/music\/tools\/.* There is no reel\/music\/music.mjs: write it/,
      ),
    })
    expect(fs.existsSync(path.join(workspace, 'reel', 'music', 'tools', 'score.mjs'))).toBe(true)
    expect(fs.existsSync(path.join(workspace, 'reel', 'music', 'reel.config.mjs'))).toBe(true)
    expect((await call()).text).toMatch(/^There is no reel\/music\/music.mjs: write it/)
    writeComposerRun(workspace, { stale: true })
    expect((await call()).text).toMatch(/older than reel\/music\/music.mjs: run the composer again/)
    writeComposerRun(workspace, { fail: true })
    expect((await call()).text).toMatch(/QC failed: ending/)
    // The reel is 15 s: 9 bars at 136 BPM, not the score's 34.
    writeComposerRun(workspace)
    expect((await call()).text).toMatch(/a 15 s reel at 136 BPM is 9 bars/)
    expect(prepareReelProject).not.toHaveBeenCalled()
  })

  it('keeps a composed score through a new frame, with its grid, but not through a new length', async () => {
    const { service, workspace } = await setUp({ lengthSec: 60, music: 'agent' })
    writeComposerRun(workspace)
    await service.callTool('s1', 'motion_music', {})
    jest.mocked(prepareReelProject).mockClear()

    const reframed = await service.callTool('s1', 'motion_setup', {
      ...ARGS,
      lengthSec: 60,
      music: 'agent',
      ratio: '9:16',
    })
    expect(reframed.text).toMatch(/The music you made is kept/)
    const kept = jest.mocked(prepareReelProject).mock.calls[0]?.[0].music
    expect(kept?.file).toMatch(/composer-\d+\.wav$/)
    expect(kept?.grid?.bpm).toBe(136)
    expect(kept?.title).toBe('Composed: F# dorian, 136 BPM')

    jest.mocked(prepareReelProject).mockClear()
    const shorter = await service.callTool('s1', 'motion_setup', { ...ARGS, music: 'agent' })
    expect(jest.mocked(prepareReelProject).mock.calls[0]?.[0].music).toBeNull()
    expect(shorter.text).toMatch(/read the `reelmakeeasy-music-composer` skill/)
    expect(shorter.text).toMatch(/call motion_music with engine "composer"/)
  })

  it('composes with the music model the user picked', async () => {
    const { service, updated } = await setUp({ music: 'agent', musicEngine: 'eleven-music' })
    const result = await service.callTool('s1', 'motion_music', { prompt: 'a bright launch track' })
    expect(result.success).toBe(true)
    expect(jest.mocked(composeMusic).mock.calls[0]?.[3]).toBe('eleven-music')
    expect(updated.at(-1)?.musicTitle).toMatch(/^ElevenLabs Music: a bright launch track/)
    const cheap = await service.callTool('s1', 'motion_music', {
      engine: 'ace-step',
      prompt: 'a bright launch track',
    })
    expect(cheap.success).toBe(true)
    expect(jest.mocked(composeMusic).mock.calls[1]?.[3]).toBe('ace-step')
    expect(await service.callTool('s1', 'motion_music', { engine: 'code', prompt: 'x' })).toEqual({
      success: false,
      text: 'engine is composer or eleven-music or ace-step.',
    })
  })

  it('carries on a chat saved when music could be written in code: the composer now, its score a plain track', async () => {
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
    expect(updated.at(-1)?.music).toEqual({ engine: 'composer', source: 'agent' })

    // A new length drops the score (its bars were the old reel's): the agent composes anew.
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
    expect(jest.mocked(prepareReelProject).mock.calls[0]?.[0].music).toBeNull()
    expect(jest.mocked(prepareReelProject).mock.calls[0]?.[0].setup.music).toEqual({
      engine: 'composer',
      source: 'agent',
    })
  })
})
