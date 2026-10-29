import {
  comparableLink,
  linksIn,
  MotionSetupError,
  motionSetupFromTool,
  parseMotionSetup,
  parseStillBeats,
} from './motion-setup'

const base = {
  lengthSec: 15,
  music: { id: 'pulse-drive', source: 'library' },
  ratio: '16:9',
  type: 'showreel',
  subject: 'ReelMakeEasy: make videos on your own computer',
}

describe('parseMotionSetup', () => {
  it('makes music the agent composes itself unless the card picked a music model', () => {
    expect(parseMotionSetup({ ...base, music: { source: 'agent' } }).music).toEqual({
      engine: 'composer',
      source: 'agent',
    })
    // A setup saved when music could be written in code reads as the composer.
    const saved = parseMotionSetup({ ...base, music: { engine: 'code', source: 'agent' } })
    expect(saved.music).toEqual({ engine: 'composer', source: 'agent' })
    expect(
      parseMotionSetup({ ...base, music: { engine: 'eleven-music', source: 'agent' } }).music,
    ).toEqual({ engine: 'eleven-music', source: 'agent' })
    expect(
      parseMotionSetup({ ...base, music: { engine: 'ace-step', source: 'agent' } }).music,
    ).toEqual({ engine: 'ace-step', source: 'agent' })
  })

  it('takes a full card', () => {
    expect(parseMotionSetup(base)).toEqual({
      ...base,
      detail: 'xhigh',
      music: { id: 'pulse-drive', source: 'library' },
    })
  })

  it('takes the detail level, Extra high when unset', () => {
    expect(parseMotionSetup({ ...base, detail: 'low' }).detail).toBe('low')
    expect(parseMotionSetup({ ...base, detail: '' }).detail).toBe('xhigh')
    expect(() => parseMotionSetup({ ...base, detail: 'max' })).toThrow(MotionSetupError)
  })

  it('trims the subject and refuses an empty or too long one', () => {
    expect(parseMotionSetup({ ...base, subject: '  hi  ' }).subject).toBe('hi')
    expect(() => parseMotionSetup({ ...base, subject: ' ' })).toThrow(MotionSetupError)
    expect(() => parseMotionSetup({ ...base, subject: 'x'.repeat(601) })).toThrow(MotionSetupError)
  })

  it('takes the kind of reel, and reads a card from before reel types by its old style', () => {
    expect(parseMotionSetup({ ...base, type: 'launch' }).type).toBe('launch')
    const { type: _type, ...noType } = base
    expect(parseMotionSetup({ ...noType, styleId: 'product-ui-launch' }).type).toBe('launch')
    expect(parseMotionSetup({ ...noType, styleId: 'hud-showreel' }).type).toBe('showreel')
    expect(parseMotionSetup({ ...noType, styleId: 'retro-pixel' })).not.toHaveProperty('styleId')
  })

  it('refuses unknown types, lengths, shapes and tracks', () => {
    const { type: _type, ...noType } = base
    expect(() => parseMotionSetup(noType)).toThrow('Pick the kind of reel: launch or showreel.')
    expect(() => parseMotionSetup({ ...base, type: 'nope' })).toThrow(/Pick the kind of reel/)
    expect(() => parseMotionSetup({ ...base, lengthSec: 17 })).toThrow(MotionSetupError)
    expect(() => parseMotionSetup({ ...base, ratio: '4:3' })).toThrow(MotionSetupError)
    expect(() => parseMotionSetup({ ...base, music: { id: 'nope', source: 'library' } })).toThrow(
      MotionSetupError,
    )
  })

  it('reads no music, and an uploaded track by its attachment name', () => {
    expect(parseMotionSetup({ ...base, music: { source: 'none' } }).music).toEqual({
      source: 'none',
    })
    expect(
      parseMotionSetup({ ...base, music: { id: 'song.mp3', source: 'upload' } }).music,
    ).toEqual({
      id: 'song.mp3',
      source: 'upload',
    })
  })

  it('takes a YouTube or public website reference and refuses anything else', () => {
    expect(
      parseMotionSetup({ ...base, reference: { kind: 'youtube', url: 'https://youtu.be/abc' } })
        .reference,
    ).toEqual({
      kind: 'youtube',
      url: 'https://youtu.be/abc',
    })
    expect(
      parseMotionSetup({ ...base, reference: { kind: 'website', url: 'example.com' } }).reference
        ?.url,
    ).toBe('https://example.com/')
    expect(() =>
      parseMotionSetup({ ...base, reference: { kind: 'youtube', url: 'https://evil.example/v' } }),
    ).toThrow(MotionSetupError)
    expect(() =>
      parseMotionSetup({ ...base, reference: { kind: 'website', url: 'http://127.0.0.1:5017' } }),
    ).toThrow(MotionSetupError)
    expect(
      parseMotionSetup({ ...base, reference: { kind: 'website', url: ' ' } }).reference,
    ).toBeUndefined()
  })
})

describe('parseStillBeats', () => {
  it('reads distinct non-negative beats, capped', () => {
    expect(parseStillBeats({ beats: '0, 4 8.5,4,-1,x' }, 6)).toEqual([0, 4, 8.5])
    expect(parseStillBeats({ beats: '1,2,3,4,5,6,7' }, 6)).toHaveLength(6)
    expect(() => parseStillBeats({ beats: '' }, 6)).toThrow(MotionSetupError)
  })
})

describe('linksIn and comparableLink', () => {
  it('finds full and bare links in what the user typed, ignoring the punctuation after them', () => {
    const links = linksIn([
      'Copy https://www.youtube.com/watch?v=abc123, please.',
      'Our site is Example.com/launch! And (https://x.io/a/)',
      'no links here: v1.2 is out',
    ])
    expect([...links].sort()).toEqual([
      'https://example.com/launch',
      'https://www.youtube.com/watch?v=abc123',
      'https://x.io/a',
    ])
  })

  it('reads a link the same way however it is written', () => {
    expect(comparableLink('EXAMPLE.com/')).toBe(comparableLink('https://example.com'))
    expect(comparableLink('https://example.com/a#top')).toBe('https://example.com/a')
    expect(comparableLink('ftp://example.com')).toBeNull()
    expect(comparableLink('   ')).toBeNull()
  })
})

describe('motionSetupFromTool', () => {
  const said = ['Make a launch reel for https://reelmakeeasy.example/ please']
  const args = {
    lengthSec: 15,
    music: 'library',
    musicId: 'pulse-drive',
    ratio: '16:9',
    type: 'showreel',
    subject: 'ReelMakeEasy: make videos on your own computer',
  }

  it('asks for the options when it names no type', () => {
    expect(motionSetupFromTool({}, said)).toBeNull()
    expect(motionSetupFromTool(undefined, said)).toBeNull()
  })

  it("reads a full call as the card's setup, checked the same way", () => {
    expect(motionSetupFromTool(args, said)).toEqual({
      detail: 'xhigh',
      lengthSec: 15,
      music: { id: 'pulse-drive', source: 'library' },
      ratio: '16:9',
      type: 'showreel',
      subject: args.subject,
    })
    expect(() => motionSetupFromTool({ ...args, lengthSec: 17 }, said)).toThrow(MotionSetupError)
    expect(() => motionSetupFromTool({ ...args, type: 'nope' }, said)).toThrow(
      /Pick the kind of reel/,
    )
    expect(motionSetupFromTool({ ...args, type: 'launch' }, said)?.type).toBe('launch')
  })

  it("takes the user's file by its path, and music the agent composes or none", () => {
    expect(
      motionSetupFromTool({ ...args, music: 'upload', musicId: 'attachments/song.mp3' }, said)
        ?.music,
    ).toEqual({ id: 'song.mp3', source: 'upload' })
    expect(motionSetupFromTool({ ...args, music: 'agent' }, said)?.music).toEqual({
      engine: 'composer',
      source: 'agent',
    })
    expect(
      motionSetupFromTool({ ...args, music: 'agent', musicEngine: 'ace-step' }, said)?.music,
    ).toEqual({ engine: 'ace-step', source: 'agent' })
    expect(() =>
      motionSetupFromTool({ ...args, music: 'agent', musicEngine: 'code' }, said),
    ).toThrow(/musicEngine is composer or eleven-music or ace-step/)
    expect(motionSetupFromTool({ ...args, music: 'none' }, said)?.music).toEqual({ source: 'none' })
    expect(() => motionSetupFromTool({ ...args, musicId: '' }, said)).toThrow(/library track id/)
    expect(() => motionSetupFromTool({ ...args, music: 'radio' }, said)).toThrow(MotionSetupError)
  })

  it('takes a reference only when the user pasted it in the chat', () => {
    const website = motionSetupFromTool({ ...args, referenceUrl: 'reelmakeeasy.example' }, said)
    expect(website?.reference).toEqual({ kind: 'website', url: 'https://reelmakeeasy.example/' })
    // A link the agent made up (or with something added) is refused: it could carry data out.
    expect(() =>
      motionSetupFromTool(
        { ...args, referenceUrl: 'https://reelmakeeasy.example/?d=secret' },
        said,
      ),
    ).toThrow(/pasted in this chat/)
    expect(() =>
      motionSetupFromTool({ ...args, referenceUrl: 'https://elsewhere.example' }, said),
    ).toThrow(/pasted in this chat/)
    const youtube = motionSetupFromTool({ ...args, referenceUrl: 'https://youtu.be/abc123' }, [
      'copy this: https://youtu.be/abc123',
    ])
    expect(youtube?.reference?.kind).toBe('youtube')
  })
})
