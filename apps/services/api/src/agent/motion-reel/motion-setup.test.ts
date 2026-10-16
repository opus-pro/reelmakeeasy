import { MotionSetupError, parseMotionSetup, parseStillBeats } from './motion-setup'

const base = {
  lengthSec: 15,
  music: { id: 'pulse-drive', source: 'library' },
  ratio: '16:9',
  styleId: 'hud-showreel',
  subject: 'ReelMakeEasy: make videos on your own computer',
}

describe('parseMotionSetup', () => {
  it('takes a full card', () => {
    expect(parseMotionSetup(base)).toEqual({
      ...base,
      music: { id: 'pulse-drive', source: 'library' },
    })
  })

  it('trims the subject and refuses an empty or too long one', () => {
    expect(parseMotionSetup({ ...base, subject: '  hi  ' }).subject).toBe('hi')
    expect(() => parseMotionSetup({ ...base, subject: ' ' })).toThrow(MotionSetupError)
    expect(() => parseMotionSetup({ ...base, subject: 'x'.repeat(601) })).toThrow(MotionSetupError)
  })

  it('refuses unknown styles, lengths, shapes and tracks', () => {
    expect(() => parseMotionSetup({ ...base, styleId: 'nope' })).toThrow('Pick a style.')
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
      parseMotionSetup({ ...base, reference: { kind: 'website', url: 'opus.pro' } }).reference?.url,
    ).toBe('https://opus.pro/')
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
