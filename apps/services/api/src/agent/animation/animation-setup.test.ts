import { localTtsSupports } from '@reelmakeeasy/common/tts/local-tts'

import {
  animationSetupFromTool,
  AnimationSetupError,
  parseAnimationSetup,
  voiceReadiness,
} from './animation-setup'

jest.mock('@reelmakeeasy/common/tts/local-tts', () => ({ localTtsSupports: jest.fn() }))
const supports = localTtsSupports as jest.MockedFunction<typeof localTtsSupports>

const ok = {
  lengthSec: 30,
  lookId: '2d',
  music: { id: 'data-pulse', source: 'library' },
  subject: 'Why the Moon drifts away',
}

describe('parseAnimationSetup', () => {
  it('takes a 2D setup with a library track', () => {
    expect(parseAnimationSetup(ok)).toEqual({
      lengthSec: 30,
      lookId: '2d',
      music: { id: 'data-pulse', source: 'library' },
      subject: 'Why the Moon drifts away',
    })
  })

  it('reads an empty subject as Surprise me', () => {
    expect(parseAnimationSetup({ ...ok, subject: '  ' }).subject).toBeNull()
    expect(parseAnimationSetup({ ...ok, subject: null }).subject).toBeNull()
  })

  it('takes music Claude makes, and no music', () => {
    expect(parseAnimationSetup({ ...ok, music: { source: 'agent' } }).music).toEqual({
      engine: 'eleven-music',
      source: 'agent',
    })
    expect(parseAnimationSetup({ ...ok, music: { source: 'none' } }).music).toEqual({
      source: 'none',
    })
  })

  it.each([
    [{ ...ok, lookId: 'vox' }, 'Pick a look.'],
    [{ ...ok, lengthSec: 60 }, 'The length must be one of 30 seconds.'],
    [{ ...ok, lengthSec: 15, lookId: '3d' }, 'The length must be one of 30, 45, 60 seconds.'],
    [{ ...ok, subject: 'x'.repeat(601) }, 'Keep what it is about under 600 characters.'],
    [{ ...ok, music: { id: 'nope', source: 'library' } }, "That music isn't available."],
    ['nothing', 'The setup is missing.'],
  ])('refuses %j', (body, message) => {
    expect(() => parseAnimationSetup(body)).toThrow(new AnimationSetupError(message))
  })
})

describe('animationSetupFromTool', () => {
  it('returns null without a look (list the options)', () => {
    expect(animationSetupFromTool({})).toBeNull()
    expect(animationSetupFromTool(undefined)).toBeNull()
  })

  it('reads the flat tool arguments', () => {
    expect(
      animationSetupFromTool({
        lengthSec: 45,
        lookId: '8bit',
        music: 'agent',
        musicEngine: 'ace-step',
        subject: 'How Taipei 101 stays still',
      }),
    ).toEqual({
      lengthSec: 45,
      lookId: '8bit',
      music: { engine: 'ace-step', source: 'agent' },
      subject: 'How Taipei 101 stays still',
    })
  })

  it('takes the user file by its name', () => {
    expect(
      animationSetupFromTool({
        lengthSec: 30,
        lookId: '3d',
        music: 'upload',
        musicId: 'attachments/song.mp3',
      })?.music,
    ).toEqual({ id: 'song.mp3', source: 'upload' })
  })
})

describe('voiceReadiness', () => {
  const env = process.env
  beforeEach(() => {
    process.env = { ...env }
    delete process.env['FAL_KEY']
  })
  afterAll(() => {
    process.env = env
  })

  it('uses this computer when Qwen3 and Kokoro run here', async () => {
    supports.mockResolvedValue(true)
    await expect(voiceReadiness()).resolves.toEqual({ designed: 'local', preset: 'local' })
  })

  it('falls back to fal for designed voices when local Qwen3 is missing', async () => {
    supports.mockResolvedValue(false)
    process.env['FAL_KEY'] = 'k'
    await expect(voiceReadiness()).resolves.toEqual({ designed: 'fal', preset: 'fal' })
  })

  it('has no designed voices without Qwen3 or a fal key', async () => {
    supports.mockImplementation(async (engine) => engine === 'kokoro')
    await expect(voiceReadiness()).resolves.toEqual({ designed: null, preset: 'local' })
  })
})
