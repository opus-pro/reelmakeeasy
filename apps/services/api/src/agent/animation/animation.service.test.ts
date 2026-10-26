import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { AgentAnimationSetupView, AgentSession } from '@shared/types/api/agent'

import { voiceReadiness } from './animation-setup'
import { AnimationService, type AnimationSessions, AnimationSetupTakenError } from './animation.service'

// Setting up installs Remotion: a stand-in here. The project itself is laid out for real.
jest.mock('../motion-reel/motion-runtime', () => ({
  ...jest.requireActual('../motion-reel/motion-runtime'),
  ensureMotionReelRuntime: jest.fn(async (say: (line: string) => void) =>
    say('Remotion is ready.'),
  ),
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

export function makeAnimation(mode: AgentSession['mode']) {
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
    service: new AnimationService(sessions),
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
    expect(options.looks.map((l) => [l.id, l.label, l.lengths, l.disabledReason ?? null])).toEqual([
      ['2d', '2D', [30], null],
      ['3d', '3D', [30, 45, 60], null],
      ['8bit', '8-bit', [30, 45, 60], null],
    ])
    expect(options.looks[0]?.defaultTrackId).toBe('data-pulse')
    expect(options.tracks.length).toBeGreaterThan(0)
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
