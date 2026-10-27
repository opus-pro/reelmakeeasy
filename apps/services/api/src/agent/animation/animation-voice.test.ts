import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  parseVoiceArgs,
  recordVoices,
  type VoiceDeps,
  VoiceArgsError,
  wordsMatch,
} from './animation-voice'
import { sineWav } from './test-wav'

/** Words spread evenly over `seconds`, as an aligner would time them. */
const timed = (text: string, seconds: number) => {
  const words = text.split(/\s+/)
  return words.map((w, i) => ({
    end: ((i + 1) * seconds) / words.length,
    start: (i * seconds) / words.length,
    text: w,
  }))
}

describe('wordsMatch', () => {
  it('ignores case and punctuation, keeps digits', () => {
    expect(wordsMatch('Did you know? 500 bees!', ['did', 'you', 'know', '500', 'bees'])).toBe(true)
    expect(wordsMatch('Did you know I move?', ['Did', 'you', 'no', 'I', 'move'])).toBe(false)
    expect(wordsMatch('It is 500 km.', ['It', 'is', 'five', 'hundred', 'km'])).toBe(false)
  })

  it('splits dashed words the way captions and transcripts do', () => {
    expect(wordsMatch('Honey never spoils\u2014ever.', ['Honey', 'never', 'spoils', 'ever.'])).toBe(
      true,
    )
  })

  it('forgives one slip in a long line, never in a short one', () => {
    const line = 'The ball hangs from 8 thick cables so it lags just behind the tower'
    expect(wordsMatch(line, line.replace('thick', 'think').split(' '))).toBe(true)
    expect(
      wordsMatch(line, line.replace('thick', 'think').replace('lags', 'legs').split(' ')),
    ).toBe(false)
  })
})

describe('parseVoiceArgs', () => {
  it('reads one "Who: words" per row and each character\'s voice', () => {
    expect(
      parseVoiceArgs({
        lines: 'Moon: Did you know I move?\n\nKid:  Really?  \nMoon: 4 cm a year!',
        pauseMs: 300,
        voices: 'Moon: an old, slow, kind moon\nKid: a quick, curious 8-year-old',
      }),
    ).toEqual({
      confirmPaid: false,
      lines: [
        { text: 'Did you know I move?', voice: 'an old, slow, kind moon', who: 'Moon' },
        { text: 'Really?', voice: 'a quick, curious 8-year-old', who: 'Kid' },
        { text: '4 cm a year!', voice: 'an old, slow, kind moon', who: 'Moon' },
      ],
      pauseMs: 300,
    })
  })

  it('refuses a line with no voice for its speaker', () => {
    expect(() => parseVoiceArgs({ lines: 'Moon: hi\nSun: hello', voices: 'Moon: old' })).toThrow(
      new VoiceArgsError('Give Sun a voice in voices ("Sun: a description of the voice").'),
    )
  })

  it('refuses a row with no speaker', () => {
    expect(() => parseVoiceArgs({ lines: 'just words', voices: 'Moon: old' })).toThrow(
      new VoiceArgsError('Line 1 must start with who says it: "Narrator: the words".'),
    )
  })

  it('refuses no lines', () => {
    expect(() => parseVoiceArgs({ lines: '', voices: '' })).toThrow(VoiceArgsError)
  })
})

describe('recordVoices', () => {
  let projectDir: string
  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'animation-voice-'))
    fs.mkdirSync(path.join(projectDir, 'public', 'voice'), { recursive: true })
  })
  afterEach(() => fs.rmSync(projectDir, { force: true, recursive: true }))

  // Like the real ones: the aligner times the script's own words; only a transcript says what
  // the take really said.
  const deps = (
    hz: number[] = [200],
    heard?: (text: string, take: number) => string,
  ): VoiceDeps => {
    let take = 0
    let last = ''
    return {
      align: jest.fn(async (_file: string, text: string) => timed(text, 1)),
      speak: jest.fn(async ({ text }: { text: string }) => {
        last = heard ? heard(text, take) : text
        return { audio: sineWav(hz[take++ % hz.length] as number, 1), ranOn: 'local' as const }
      }),
      transcribe: jest.fn(async () => last.split(/\s+/)),
    }
  }

  it('records each line, times its words and joins them', async () => {
    const d = deps()
    const result = await recordVoices({
      deps: d,
      fps: 30,
      lines: [
        { text: 'Did you know I move?', voice: 'old, slow', who: 'Moon' },
        { text: 'Really?', voice: 'young, quick', who: 'Kid' },
      ],
      pauseMs: 250,
      projectDir,
    })
    expect(result.warnings).toEqual([])
    const [first, second] = result.lines
    expect(first).toMatchObject({ start: 0, text: 'Did you know I move?', who: 'Moon' })
    expect(first?.words.map((w) => w.text)).toEqual(['Did', 'you', 'know', 'I', 'move?'])
    expect(first?.end).toBeCloseTo(1, 1)
    // The second line starts after the first and the pause.
    expect(second?.start).toBeCloseTo(1.25, 1)
    expect(second?.words[0]?.start).toBeCloseTo(second?.start as number, 2)
    // One loudness value per frame of the 1 s line (resampling may add a frame).
    expect(Math.abs((first?.envelope.length ?? 0) - 30)).toBeLessThanOrEqual(1)
    expect(Math.max(...(first?.envelope ?? []))).toBeGreaterThan(0.3)
    expect(fs.existsSync(path.join(projectDir, 'public', 'voice.wav'))).toBe(true)
    expect(fs.existsSync(path.join(projectDir, 'public', 'voice', 'line1.wav'))).toBe(true)
    const saved = JSON.parse(
      fs.readFileSync(path.join(projectDir, 'public', 'voice', 'lines.json'), 'utf8'),
    ) as unknown[]
    expect(saved).toHaveLength(2)
    expect(result.totalSec).toBeCloseTo(2.25, 1)
  })

  it('retries a take whose words do not match, then warns about it', async () => {
    const d = deps([200], (text) => text.replace('know', 'no'))
    const result = await recordVoices({
      deps: d,
      fps: 30,
      lines: [{ text: 'Did you know I move?', voice: 'old', who: 'Moon' }],
      projectDir,
    })
    expect(d.speak).toHaveBeenCalledTimes(3)
    expect(result.warnings).toEqual([
      'Line 1 ("Did you know I move?") may have a clipped or misheard word: listen to it.',
    ])
    expect(result.lines).toHaveLength(1)
  })

  it('takes a second take when the first is misheard', async () => {
    const d = deps([200], (text, take) => (take === 0 ? text.replace('move', 'groove') : text))
    const result = await recordVoices({
      deps: d,
      fps: 30,
      lines: [{ text: 'Did you know I move?', voice: 'old', who: 'Moon' }],
      projectDir,
    })
    expect(d.speak).toHaveBeenCalledTimes(2)
    expect(result.warnings).toEqual([])
  })

  it("keeps the take nearest the character's first pitch", async () => {
    // Line 1 (Moon) at 190 Hz. Line 2 (Moon): takes at 260 then 180 Hz: both right, 180 is nearer.
    const d = deps([190, 260, 180, 180])
    const result = await recordVoices({
      deps: d,
      fps: 30,
      lines: [
        { text: 'one two', voice: 'old', who: 'Moon' },
        { text: 'three four', voice: 'old', who: 'Moon' },
      ],
      projectDir,
    })
    expect(result.lines[1]?.pitchHz).toBeLessThan(200)
  })

  it('says when anything ran on fal', async () => {
    const d: VoiceDeps = {
      align: async (_f, text) => timed(text, 1),
      speak: async () => ({ audio: sineWav(200, 1), ranOn: 'fal' }),
      transcribe: async () => ['hi', 'there'],
    }
    const result = await recordVoices({
      deps: d,
      fps: 30,
      lines: [{ text: 'hi there', voice: 'old', who: 'Moon' }],
      projectDir,
    })
    expect(result.ranOnFal).toBe(true)
  })
})
