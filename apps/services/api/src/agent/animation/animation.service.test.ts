import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { AgentAnimationSetupView, AgentSession } from '@shared/types/api/agent'

import { presetPath } from '@reelmakeeasy/common/storage/presets'

import { composeMusic } from '../motion-reel/motion-music'
import { renderReel, renderStills } from '../motion-reel/motion-render'

import { voiceReadiness } from './animation-setup'
import type { VoiceDeps } from './animation-voice'
import { sineWav } from './test-wav'
import {
  AnimationService,
  type AnimationSessions,
  AnimationSetupTakenError,
} from './animation.service'

// Setting up installs Remotion: a stand-in here. The project itself is laid out for real.
jest.mock('../motion-reel/motion-runtime', () => ({
  ...jest.requireActual('../motion-reel/motion-runtime'),
  ensureMotionReelRuntime: jest.fn(async (say: (line: string) => void) =>
    say('Remotion is ready.'),
  ),
}))
jest.mock('../motion-reel/motion-render', () => ({
  ...jest.requireActual('../motion-reel/motion-render'),
  renderReel: jest.fn(async (dir: string) => {
    const out = path.join(dir, 'out')
    fs.mkdirSync(out, { recursive: true })
    fs.writeFileSync(path.join(out, 'animation.mp4'), 'mp4')
    fs.writeFileSync(path.join(out, 'poster.jpg'), 'jpg')
    return { file: path.join(out, 'animation.mp4'), poster: path.join(out, 'poster.jpg') }
  }),
  renderStills: jest.fn(async (_dir: string, frames: number[], outDir: string) => {
    fs.mkdirSync(outDir, { recursive: true })
    return frames.map((f) => {
      const file = path.join(outDir, `frame-${f}.png`)
      fs.writeFileSync(file, 'png')
      return file
    })
  }),
  typeCheck: jest.fn(async () => null),
}))
jest.mock('../motion-reel/motion-music', () => ({
  ...jest.requireActual('../motion-reel/motion-music'),
  composeMusic: jest.fn(async (_request: unknown, _sec: number, dir: string, key?: string) => {
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `composed-${Date.now()}.mp3`)
    fs.copyFileSync(presetPath('motion-reel/music/data-pulse-60s.mp3'), file)
    return { file, model: key ?? 'role' }
  }),
}))
jest.mock('@reelmakeeasy/common/storage/stored-files', () => ({
  uploadToStore: jest.fn(async () => undefined),
}))
jest.mock('./animation-setup', () => ({
  ...jest.requireActual('./animation-setup'),
  voiceReadiness: jest.fn(async () => ({ designed: 'local', preset: 'local' })),
}))

const CARD = {
  lengthSec: 30,
  lookId: '2d',
  music: { source: 'none' },
  subject: 'Why honey never spoils',
}

export function makeAnimation(mode: AgentSession['mode'], voice?: VoiceDeps) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'animation-svc-'))
  let session: AgentSession = {
    createdAt: '',
    id: 's1',
    mode,
    projectId: null,
    status: 'idle',
    threadId: null,
    title: 'x',
  }
  const messages: string[] = []
  const updated: AgentAnimationSetupView[] = []
  const started: { prompt: string; setup: AgentAnimationSetupView }[] = []
  const sessions: AnimationSessions = {
    attachmentsDir: () => path.join(workspace, 'attachments'),
    emitAutonomousEvent: jest.fn(),
    emitImage: jest.fn(),
    emitMessage: (_id, text) => messages.push(text),
    emitNotice: (_id, text) => messages.push(`notice: ${text}`),
    getSession: () => session,
    setFlowWorking: jest.fn(),
    startAnimation: (_id, setup, prompt) => {
      started.push({ prompt, setup })
      session = { ...session, animation: setup }
    },
    updateAnimation: (_id, view) => {
      updated.push(view)
      session = { ...session, animation: view }
    },
    workingDir: () => workspace,
  }
  return {
    messages,
    service: new AnimationService(sessions, voice ? { voice } : {}),
    sessions,
    started,
    updated,
    workspace,
  }
}

const waitFor = async (check: () => boolean) => {
  const end = Date.now() + 3000
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('AnimationService, the setup card', () => {
  it('lists the three looks with their lengths and tracks', async () => {
    const { service } = makeAnimation('animation')
    const options = await service.options()
    const lengths = [15, 30, 45, 60, 90]
    expect(options.looks.map((l) => [l.id, l.label, l.lengths, l.disabledReason ?? null])).toEqual([
      ['2d', '2D', lengths, null],
      ['3d', '3D', lengths, null],
      ['8bit', '8-bit', lengths, null],
    ])
    expect([options.minLengthSec, options.maxLengthSec]).toEqual([10, 90])
    expect(options.looks[0]?.defaultTrackId).toBe('data-pulse')
    // Every look has a preview clip in the presets.
    for (const look of options.looks) expect(look.previewUrl).toMatch(/animation\/looks\/.+\.mp4$/)
    expect(options.tracks.length).toBeGreaterThan(0)
    // Music models only (the code composer is Motion Reel's).
    expect(options.composers.map((c) => c.id)).toEqual(['eleven-music', 'ace-step'])
  })

  it('disables 2D when no designed voices can be made here', async () => {
    jest.mocked(voiceReadiness).mockResolvedValueOnce({ designed: null, preset: 'local' })
    const { service } = makeAnimation('animation')
    const looks = (await service.options()).looks
    expect(looks.map((l) => l.disabledReason ?? null)).toEqual([
      'Needs Qwen3 voices on this computer or a fal key.',
      null,
      null,
    ])
  })

  it('readies the project and starts Claude with the look skill', async () => {
    const { messages, service, started, workspace } = makeAnimation('animation')
    service.setup('s1', CARD)
    await waitFor(() => started.length === 1)
    expect(started[0]?.setup).toEqual({
      lengthSec: 30,
      lookId: '2d',
      lookLabel: '2D',
      music: { source: 'none' },
      musicTitle: null,
      subject: 'Why honey never spoils',
    })
    expect(started[0]?.prompt).toContain('reelmakeeasy-animation-2d')
    expect(messages).toContain('Remotion is ready.')
    expect(fs.existsSync(path.join(workspace, 'animation', 'brief.md'))).toBe(true)
  })

  it('takes the card once', async () => {
    const { service, started } = makeAnimation('animation')
    service.setup('s1', CARD)
    expect(() => service.setup('s1', CARD)).toThrow(AnimationSetupTakenError)
    await waitFor(() => started.length === 1)
    expect(() => service.setup('s1', CARD)).toThrow(new AnimationSetupTakenError())
  })

  it('names the library track it put under the voice', async () => {
    const { service, started } = makeAnimation('animation')
    service.setup('s1', { ...CARD, music: { id: 'data-pulse', source: 'library' } })
    await waitFor(() => started.length === 1)
    expect(started[0]?.setup.musicTitle).toBeTruthy()
  })
})

describe('AnimationService, animation_voice', () => {
  const fakeVoice = (): VoiceDeps & { voices: string[] } => {
    const voices: string[] = []
    return {
      align: jest.fn(async (_f: string, text: string) =>
        text.split(/\s+/).map((w, i) => ({ end: (i + 1) * 0.3, start: i * 0.3, text: w })),
      ),
      speak: jest.fn(async ({ voice }: { voice: string }) => {
        voices.push(voice)
        return { audio: sineWav(200, 1.2), ranOn: 'local' as const }
      }),
      transcribe: jest.fn(async () => {
        throw new Error('no transcript here')
      }),
      voices,
    }
  }
  const LINES = {
    lines: 'Bee: Did you know honey never spoils?\nJar: Not even after 3000 years!',
    voices: 'Bee: a cheerful bee\nJar: a slow old jar',
  }

  afterEach(() =>
    jest.mocked(voiceReadiness).mockResolvedValue({ designed: 'local', preset: 'local' }),
  )

  async function ready(lookId = '2d', voice = fakeVoice()) {
    const made = makeAnimation('animation', voice)
    made.service.setup('s1', { ...CARD, lookId })
    await waitFor(() => made.started.length === 1)
    return { ...made, voice }
  }

  it('records the lines and points the project at the voice', async () => {
    const { service, workspace } = await ready()
    const result = await service.callTool('s1', 'animation_voice', LINES)
    expect(result.success).toBe(true)
    expect(result.text).toMatch(/Recorded 2 lines \(Bee, Jar\): .* s in all/)
    const spec = JSON.parse(
      fs.readFileSync(path.join(workspace, 'animation/public/animation.json'), 'utf8'),
    ) as { voiceFile: string }
    expect(spec.voiceFile).toBe('voice.wav')
  })

  it('asks before paying for fal voices', async () => {
    jest.mocked(voiceReadiness).mockResolvedValue({ designed: 'fal', preset: 'fal' })
    const { service, voice } = await ready()
    const ask = await service.callTool('s1', 'animation_voice', LINES)
    expect(ask.success).toBe(false)
    expect(ask.text).toMatch(/run on fal, paid.*confirmPaid: true/)
    expect(voice.speak).not.toHaveBeenCalled()
    const done = await service.callTool('s1', 'animation_voice', { ...LINES, confirmPaid: true })
    expect(done.success).toBe(true)
  })

  it('fails plainly with no way to make designed voices for two characters', async () => {
    const { service } = await ready()
    jest.mocked(voiceReadiness).mockResolvedValueOnce({ designed: null, preset: 'local' })
    const result = await service.callTool('s1', 'animation_voice', LINES)
    expect(result).toEqual({
      success: false,
      text: 'No designed voices here: install Qwen3 voices (run setup again) or add a fal key.',
    })
  })

  it('gives a narrator a preset voice when designed voices are missing', async () => {
    const { service, voice } = await ready('3d')
    jest.mocked(voiceReadiness).mockResolvedValueOnce({ designed: null, preset: 'local' })
    const result = await service.callTool('s1', 'animation_voice', {
      lines: 'Narrator: The heart has 4 rooms.',
      voices: 'Narrator: a calm doctor',
    })
    expect(result.success).toBe(true)
    expect(voice.voices).toEqual(['kokoro-am_michael'])
    expect(result.text).toMatch(/preset voice/)
  })

  it('says which lines to cut when the voice runs long', async () => {
    const { service } = await ready()
    const many = Array.from({ length: 30 }, (_, i) => `Bee: Line number ${i + 1} is here.`)
    const result = await service.callTool('s1', 'animation_voice', {
      lines: many.join('\n'),
      voices: 'Bee: a cheerful bee',
    })
    expect(result.text).toMatch(/longer than the 30 s asked for: shorten or cut lines/)
  })

  it('needs the animation set up first', async () => {
    const { service } = makeAnimation('animation_free', fakeVoice())
    await expect(service.callTool('s1', 'animation_voice', LINES)).resolves.toEqual({
      success: false,
      text: 'Set the animation up first: call animation_setup.',
    })
  })
})

describe('AnimationService, look, music and render', () => {
  async function ready(card: object = {}) {
    const made = makeAnimation('animation')
    made.service.setup('s1', { ...CARD, ...card })
    await waitFor(() => made.started.length === 1)
    return made
  }

  it('renders stills at the seconds asked, and shows them', async () => {
    const { service, sessions } = await ready()
    const result = await service.callTool('s1', 'animation_still', { seconds: '0, 12.5, 99' })
    expect(result.success).toBe(true)
    expect(jest.mocked(renderStills).mock.calls.at(-1)?.[1]).toEqual([0, 375, 899])
    expect(jest.mocked(renderStills).mock.calls.at(-1)?.[3]).toBe('Animation')
    expect(sessions.emitImage).toHaveBeenCalledTimes(3)
    expect(result.text).toMatch(/- 12.5 s \(frame 375\): animation\/out\/stills\//)
  })

  it('shows the render as a video in the chat', async () => {
    const { service, sessions } = await ready()
    const result = await service.callTool('s1', 'animation_render', {})
    expect(result.success).toBe(true)
    expect(jest.mocked(renderReel).mock.calls.at(-1)?.[1]).toEqual({
      composition: 'Animation',
      name: 'animation',
      sync: false,
    })
    const event = jest.mocked(sessions.emitAutonomousEvent).mock.calls.at(-1)?.[1] as {
      type: string
      videoUrl: string
    }
    expect(event.type).toBe('motion_video')
    expect(event.videoUrl).toMatch(/^store:\/\/agent-animation\/s1\/animation-.*\.mp4$/)
    expect(result.text).toMatch(/animation\/out\/animation.mp4/)
  })

  it('puts the music Claude made under the voice, fitted to the length', async () => {
    const { service, updated, workspace } = await ready({
      music: { engine: 'ace-step', source: 'agent' },
    })
    const result = await service.callTool('s1', 'animation_music', {
      prompt: 'gentle ukulele, warm and curious',
    })
    expect(result.success).toBe(true)
    expect(jest.mocked(composeMusic).mock.calls.at(-1)?.[3]).toBe('ace-step')
    const spec = JSON.parse(
      fs.readFileSync(path.join(workspace, 'animation/public/animation.json'), 'utf8'),
    ) as { musicFile: string }
    expect(spec.musicFile).toBe('music.wav')
    expect(updated.at(-1)?.musicTitle).toMatch(/^ACE-Step: gentle ukulele/)
  })
})

describe('AnimationService, an Advanced chat', () => {
  it('lists the looks, lengths and music when animation_setup names no look', async () => {
    const { service, updated } = makeAnimation('animation_free')
    const result = await service.callTool('s1', 'animation_setup', {})
    expect(result.success).toBe(true)
    expect(result.text).toMatch(/- 2d: 2D\. Cartoon characters/)
    expect(result.text).toMatch(/Length \(lengthSec\): any whole number of seconds from 10 to 90 \(15, 30, 45, 60 or 90 suggested; default 30\)/)
    expect(result.text).toMatch(/- data-pulse: /)
    expect(updated).toEqual([])
  })

  it('readies the project, shows the setup and says what to read next', async () => {
    const { messages, service, updated } = makeAnimation('animation_free')
    const result = await service.callTool('s1', 'animation_setup', {
      lengthSec: 45,
      lookId: '3d',
      music: 'none',
      subject: 'How a heart pumps',
    })
    expect(result.success).toBe(true)
    expect(result.text).toMatch(/^`animation\/` is ready: 3D, about 45 s, no music\./)
    expect(result.text).toMatch(/reelmakeeasy-animation-3d/)
    expect(updated.at(-1)).toMatchObject({ lookId: '3d', lookLabel: '3D' })
    expect(messages).toContain('Remotion is ready.')
    const again = await service.callTool('s1', 'animation_setup', {
      lengthSec: 30,
      lookId: '3d',
      music: 'none',
      subject: 'How a heart pumps',
    })
    expect(again.text).toMatch(/set up again.*Your scenes were kept/)
  })

  it('keeps the music it made when set up again the same way (no second paid track)', async () => {
    const { service, updated, workspace } = makeAnimation('animation_free')
    const ARGS = {
      lengthSec: 45,
      lookId: '3d',
      music: 'agent',
      musicEngine: 'ace-step',
      subject: 'Volcanoes',
    }
    await service.callTool('s1', 'animation_setup', ARGS)
    await service.callTool('s1', 'animation_music', { prompt: 'deep drums' })
    const made = updated.at(-1)?.musicTitle
    expect(made).toMatch(/^ACE-Step: deep drums/)
    jest.mocked(composeMusic).mockClear()

    const again = await service.callTool('s1', 'animation_setup', { ...ARGS, lengthSec: 60 })
    expect(again.text).toMatch(/The music you made is kept/)
    expect(again.text).not.toMatch(/make it with animation_music/)
    expect(composeMusic).not.toHaveBeenCalled()
    expect(updated.at(-1)).toMatchObject({ lengthSec: 60, musicTitle: made })
    expect(fs.existsSync(path.join(workspace, 'animation/public/music.wav'))).toBe(true)
  })

  it('refuses a bad setup plainly', async () => {
    const { service } = makeAnimation('animation_free')
    await expect(
      service.callTool('s1', 'animation_setup', { lengthSec: 120, lookId: '2d' }),
    ).resolves.toEqual({ success: false, text: 'The length must be 10 to 90 seconds.' })
  })

  it("won't set up an Easy chat from the tool", async () => {
    const { service } = makeAnimation('animation')
    const result = await service.callTool('s1', 'animation_setup', { lookId: '2d' })
    expect(result.success).toBe(false)
  })
})
