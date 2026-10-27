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
  it("takes a Talking head's avatar: a saved one, or a new one with a name, photo and style", () => {
    const head = { ...ok, lookId: 'avatar' }
    expect(parseAnimationSetup({ ...head, avatar: { id: 'av-0123456789' } }).avatar).toEqual({
      id: 'av-0123456789',
    })
    expect(
      parseAnimationSetup({ ...head, avatar: { name: ' Sam ', photo: 'me.jpg', style: '3d' } })
        .avatar,
    ).toEqual({ name: 'Sam', photo: 'me.jpg', style: '3d' })
    expect(() => parseAnimationSetup(head)).toThrow(/Pick an avatar/)
    expect(() =>
      parseAnimationSetup({ ...head, avatar: { name: 'Sam', photo: '', style: '2d' } }),
    ).toThrow(/Add a photo/)
    expect(() =>
      parseAnimationSetup({ ...head, avatar: { name: 'Sam', photo: 'me.jpg', style: '4d' } }),
    ).toThrow(/2D or 3D/)
    // Another look never carries an avatar.
    expect(parseAnimationSetup({ ...ok, avatar: { id: 'av-0123456789' } }).avatar).toBeUndefined()
  })

  it("takes an Advanced chat's avatar from flat arguments", () => {
    expect(
      animationSetupFromTool({
        avatarName: 'Sam',
        avatarPhoto: 'attachments/me.jpg',
        avatarStyle: '2d',
        lengthSec: 30,
        lookId: 'avatar',
        music: 'none',
      })?.avatar,
    ).toEqual({ name: 'Sam', photo: 'attachments/me.jpg', style: '2d' })
    expect(
      animationSetupFromTool({
        avatarId: 'av-0123456789',
        lengthSec: 30,
        lookId: 'avatar',
        music: 'none',
      })?.avatar,
    ).toEqual({ id: 'av-0123456789' })
  })

  it('takes a 2D setup with a library track', () => {
    expect(parseAnimationSetup(ok)).toEqual({
      lengthSec: 30,
      lookId: '2d',
      music: { id: 'data-pulse', source: 'library' },
      subject: 'Why the Moon drifts away',
    })
  })

  it('takes any whole number of seconds from 10 to 90, for every look', () => {
    expect(parseAnimationSetup({ ...ok, lengthSec: 90 }).lengthSec).toBe(90)
    expect(parseAnimationSetup({ ...ok, lengthSec: 22, lookId: '3d' }).lengthSec).toBe(22)
    expect(parseAnimationSetup({ ...ok, lengthSec: 10, lookId: '8bit' }).lengthSec).toBe(10)
  })

  it('reads an empty subject as Surprise me', () => {
    expect(parseAnimationSetup({ ...ok, subject: '  ' }).subject).toBeNull()
    expect(parseAnimationSetup({ ...ok, subject: null }).subject).toBeNull()
  })

  it('takes music Claude makes, and no music', () => {
    expect(parseAnimationSetup({ ...ok, music: { source: 'agent' } }).music).toEqual({
      engine: 'composer',
      source: 'agent',
    })
    expect(parseAnimationSetup({ ...ok, music: { source: 'none' } }).music).toEqual({
      source: 'none',
    })
  })

  it('lets Claude compose the music itself (the default), or use a music model', () => {
    expect(
      parseAnimationSetup({ ...ok, music: { engine: 'composer', source: 'agent' } }).music,
    ).toEqual({ engine: 'composer', source: 'agent' })
    expect(
      parseAnimationSetup({ ...ok, music: { engine: 'ace-step', source: 'agent' } }).music,
    ).toEqual({ engine: 'ace-step', source: 'agent' })
  })

  it.each([
    [{ ...ok, lookId: 'vox' }, 'Pick a look.'],
    [{ ...ok, lengthSec: 95 }, 'The length must be 10 to 90 seconds.'],
    [{ ...ok, lengthSec: 5 }, 'The length must be 10 to 90 seconds.'],
    [{ ...ok, lengthSec: 22.5 }, 'The length must be 10 to 90 seconds.'],
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
        subject: 'How Tokyo Skytree stays up in an earthquake',
      }),
    ).toEqual({
      lengthSec: 45,
      lookId: '8bit',
      music: { engine: 'ace-step', source: 'agent' },
      subject: 'How Tokyo Skytree stays up in an earthquake',
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
