import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The voice is faked: each line "says" a 440 Hz tone for as long as `speechSeconds` says,
// between 0.2 s of silence before and 0.3 s after. FFmpeg makes the audio and measures it.
const speechSeconds = new Map<string, number>()
const tts = jest.fn()
let route: { provider: string; substitutedFrom?: string; voiceId: string } = {
  provider: 'kokoro',
  voiceId: 'kokoro-af_heart',
}
/** Routes by voice id, ahead of `route` (a voice that can't run here, its stand-in...). */
const routes = new Map<string, { provider: string; substitutedFrom?: string; voiceId: string }>()
/** What `defaultLoopVoiceId` answers: a free voice on this computer, when one is installed. */
let loopDefault = 'kokoro-af_heart'
jest.mock('./provider-tts.util', () => ({
  generateTTSAudio: async (
    text: string,
    voiceId: string,
    model: string,
    provider: string,
    userContext: unknown,
    options: unknown,
  ) => {
    tts({ model, options, provider, text, userContext, voiceId })
    return { audioBuffer: speechWav(speechSeconds.get(text) ?? 2.6) }
  },
  resolveTtsModel: (provider: string) => `${provider}-model`,
  resolveVoiceRoute: async (voiceId: string) => routes.get(voiceId) ?? route,
}))
jest.mock('@reelmakeeasy/common/tts/default-voice', () => ({
  defaultLoopVoiceId: async () => loopDefault,
}))
const localEngines = { kokoro: true, qwen3: false }
jest.mock('@reelmakeeasy/common/tts/local-tts', () => ({
  localTtsSupports: async (engine: 'kokoro' | 'qwen3') => localEngines[engine],
}))

import {
  checkBeatLoopLines,
  lineAudioExtension,
  measureLineSpeech,
  speakBeatLoopLine,
} from './beat-loop-lines.util'

let root = ''
let cacheDir = ''

/** A WAV header with no samples: audio a voice sent back that FFmpeg can't measure. */
function headerOnlyWav(): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'latin1')
  header.writeUInt32LE(36, 4)
  header.write('WAVEfmt ', 8, 'latin1')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(24000, 24)
  header.writeUInt32LE(48000, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'latin1')
  return header
}

function speechWav(seconds: number): Buffer {
  if (seconds < 0) return headerOnlyWav()
  if (seconds === 0) {
    const file = path.join(root, `silence-${Math.random().toString(36).slice(2)}.wav`)
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=24000:cl=mono',
      '-t',
      '1',
      file,
    ])
    return fs.readFileSync(file)
  }
  const file = path.join(root, `tts-${seconds}-${Math.random().toString(36).slice(2)}.wav`)
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:sample_rate=24000:duration=${seconds}`,
    '-af',
    'adelay=200,apad=pad_dur=0.3',
    '-ac',
    '1',
    file,
  ])
  return fs.readFileSync(file)
}

const LINES = [
  { id: 's1', narration: 'Honey found in ancient tombs was still good to eat.' },
  { id: 's2', narration: 'Archaeologists said: "the old honey was still perfectly edible" today.' },
  { id: 's3', narration: 'That leaves too little water for any germ to grow.' },
]

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'beat-loop-lines-'))
  cacheDir = path.join(root, 'cache')
  speechSeconds.clear()
  tts.mockReset()
  route = { provider: 'kokoro', voiceId: 'kokoro-af_heart' }
  routes.clear()
  loopDefault = 'kokoro-af_heart'
  localEngines.kokoro = true
})
afterEach(() => fs.rmSync(root, { force: true, recursive: true }))

describe('speakBeatLoopLine', () => {
  const line = (text: string, voiceId = 'kokoro-af_heart') => ({
    cacheDir,
    projectId: 'p1',
    route: { provider: 'kokoro' as const, voiceId },
    text,
    ttsModel: 'kokoro-model',
    userContext: { userEmail: 'you@reelmakeeasy.local', userId: 'u1' },
  })

  it('says a line once: the same voice and words are never paid for twice', async () => {
    const first = await speakBeatLoopLine(line(LINES[0].narration))
    const again = await speakBeatLoopLine(line(LINES[0].narration))

    expect(first.cached).toBe(false)
    expect(again.cached).toBe(true)
    expect(again.audioBuffer.equals(first.audioBuffer)).toBe(true)
    expect(tts).toHaveBeenCalledTimes(1)
    expect(tts).toHaveBeenCalledWith({
      model: 'kokoro-model',
      options: { languageCode: 'en', projectId: 'p1' },
      provider: 'kokoro',
      text: LINES[0].narration,
      userContext: { userEmail: 'you@reelmakeeasy.local', userId: 'u1' },
      voiceId: 'kokoro-af_heart',
    })
  })

  it('says it again for other words or another voice', async () => {
    await speakBeatLoopLine(line(LINES[0].narration))
    await speakBeatLoopLine(line(LINES[2].narration))
    await speakBeatLoopLine(line(LINES[0].narration, 'kokoro-af_bella'))
    expect(tts).toHaveBeenCalledTimes(3)
  })

  it('still answers when the audio cannot be kept', async () => {
    fs.writeFileSync(cacheDir, 'not a folder')
    const result = await speakBeatLoopLine(line(LINES[0].narration))
    expect(result.cached).toBe(false)
    expect(result.audioBuffer.length).toBeGreaterThan(44)
  })
})

describe('measureLineSpeech', () => {
  it('measures from the first sound to the last, leaving the silence out', async () => {
    const file = path.join(root, 'line.wav')
    fs.writeFileSync(file, speechWav(2.6))
    const speech = await measureLineSpeech(file)
    expect(speech?.start).toBeCloseTo(0.2, 1)
    expect(speech?.seconds).toBeCloseTo(2.6, 1)
    expect(lineAudioExtension(fs.readFileSync(file))).toBe('.wav')
  })

  it('is null for a silent line', async () => {
    const file = path.join(root, 'silent.wav')
    fs.writeFileSync(file, speechWav(0))
    await expect(measureLineSpeech(file)).resolves.toBeNull()
  })
})

describe('checkBeatLoopLines', () => {
  it('says every line in the voice and measures it by the fit rule (3.45 s, at most 1.3x)', async () => {
    speechSeconds.set(LINES[1].narration, 4.9)
    speechSeconds.set(LINES[2].narration, 3.9)

    const check = await checkBeatLoopLines({ cacheDir, clips: LINES, voiceId: 'kokoro-af_heart' })

    expect(check).toEqual({
      free: true,
      lines: [
        expect.objectContaining({ clipId: 's1', clipIndex: 0, fits: true, tempo: 1 }),
        expect.objectContaining({ clipId: 's2', clipIndex: 1, fits: false }),
        expect.objectContaining({ clipId: 's3', clipIndex: 2, fits: true }),
      ],
      provider: 'kokoro',
      voiceId: 'kokoro-af_heart',
    })
    expect(check.lines[1].seconds).toBeCloseTo(4.9, 1)
    expect(check.lines[1].narration).toBe(LINES[1].narration)
    expect(check.lines[2].tempo).toBeCloseTo(3.9 / 3.45, 1)
    // Lines are said a few at a time, so the calls can land in any order.
    expect(tts.mock.calls.map(([call]) => call.text).sort()).toEqual(
      LINES.map((l) => l.narration).sort(),
    )

    // The run says the same lines with the same voice: from the cache, at no cost.
    await checkBeatLoopLines({ cacheDir, clips: LINES, voiceId: 'kokoro-af_heart' })
    expect(tts).toHaveBeenCalledTimes(3)
  })

  it('says whether the voice is free: a local voice is, a paid one or Kokoro on fal is not', async () => {
    route = { provider: 'elevenlabs', voiceId: 'EXAVITQu4vr4xnSDxMaL' }
    const paid = await checkBeatLoopLines({ cacheDir, clips: LINES.slice(0, 1), voiceId: 'Sarah' })
    expect(paid).toEqual(
      expect.objectContaining({ free: false, provider: 'elevenlabs', voiceId: route.voiceId }),
    )
    route = { provider: 'kokoro', voiceId: 'kokoro-af_heart' }
    localEngines.kokoro = false
    const onFal = await checkBeatLoopLines({ cacheDir, clips: LINES.slice(0, 1), voiceId: 'x' })
    expect(onFal.free).toBe(false)
  })

  it("says the lines in the loop's free voice when the one named can't run here", async () => {
    // A voice that can't run here (a retired one, say): the router would put the paid default
    // voice (Sarah) in its place, and every line would be paid for before any card.
    routes.set('gemini-Kore', {
      provider: 'elevenlabs',
      substitutedFrom: 'gemini-Kore',
      voiceId: 'EXAVITQu4vr4xnSDxMaL',
    })
    routes.set('kokoro-af_heart', { provider: 'kokoro', voiceId: 'kokoro-af_heart' })

    const check = await checkBeatLoopLines({
      cacheDir,
      clips: LINES.slice(0, 1),
      voiceId: 'gemini-Kore',
    })

    expect(check).toEqual(
      expect.objectContaining({ free: true, provider: 'kokoro', voiceId: 'kokoro-af_heart' }),
    )
    expect(tts).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'kokoro', voiceId: 'kokoro-af_heart' }),
    )
    // No free voice installed: the default voice it is, as before.
    loopDefault = 'EXAVITQu4vr4xnSDxMaL'
    routes.set('EXAVITQu4vr4xnSDxMaL', { provider: 'elevenlabs', voiceId: 'EXAVITQu4vr4xnSDxMaL' })
    const paid = await checkBeatLoopLines({
      cacheDir,
      clips: LINES.slice(0, 1),
      voiceId: 'gemini-Kore',
    })
    expect(paid).toEqual(expect.objectContaining({ free: false, voiceId: 'EXAVITQu4vr4xnSDxMaL' }))
  })

  it('stops saying lines once asked to (the user pressed Stop), and throws', async () => {
    const clips = [...LINES, ...LINES].map((line, i) => ({
      id: `s${i + 1}`,
      narration: `${line.narration} ${i}`,
    }))
    let stop = false
    tts.mockImplementation(() => {
      stop = true
    })

    await expect(
      checkBeatLoopLines({ cacheDir, clips, shouldStop: () => stop, voiceId: 'kokoro-af_heart' }),
    ).rejects.toThrow(/Stopped/)
    // The lines already under way finish; none starts after the Stop.
    expect(tts.mock.calls.length).toBeLessThan(clips.length)
  })

  it("forgets a line whose audio can't be measured, so a retry says it again", async () => {
    // A header with no samples: FFmpeg can't tell its length.
    speechSeconds.set(LINES[0].narration, -1)
    await expect(
      checkBeatLoopLines({ cacheDir, clips: LINES.slice(0, 1), voiceId: 'kokoro-af_heart' }),
    ).rejects.toThrow(/clip s1/)
    speechSeconds.set(LINES[0].narration, 2.6)
    const check = await checkBeatLoopLines({
      cacheDir,
      clips: LINES.slice(0, 1),
      voiceId: 'kokoro-af_heart',
    })
    expect(check.lines[0].fits).toBe(true)
    expect(tts).toHaveBeenCalledTimes(2)
  })

  it('names a line the voice said nothing for, and forgets it so a retry says it again', async () => {
    speechSeconds.set(LINES[0].narration, 0)
    await expect(
      checkBeatLoopLines({ cacheDir, clips: LINES.slice(0, 1), voiceId: 'kokoro-af_heart' }),
    ).rejects.toThrow('The voice came back silent for clip s1')
    speechSeconds.set(LINES[0].narration, 2.6)
    const check = await checkBeatLoopLines({
      cacheDir,
      clips: LINES.slice(0, 1),
      voiceId: 'kokoro-af_heart',
    })
    expect(check.lines[0].fits).toBe(true)
    expect(tts).toHaveBeenCalledTimes(2)
  })
})
