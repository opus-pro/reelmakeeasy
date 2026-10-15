import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { TranscriptData } from '@shared/types/agent/transcript'
import type { BeatLoopStoryboard } from '@shared/types/api/agent'

// The voiceover activity on FFmpeg-made "speech": a tone between two silences stands in for
// each TTS line. The voice, the aligner and storage are faked.
let root = ''
jest.mock('../long-take/storage', () => ({
  ...jest.requireActual('../long-take/storage'),
  createLongTakeStorage: () => ({
    getFullPath: (relative: string) => path.join(root, relative),
    uploadFile: async (local: string, relative: string) => {
      fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
      fs.copyFileSync(local, path.join(root, relative))
      return relative
    },
    writeFile: async (relative: string, content: string) => {
      fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
      fs.writeFileSync(path.join(root, relative), content)
      return relative
    },
    writeJsonFile: async (relative: string, data: unknown) => {
      fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
      fs.writeFileSync(path.join(root, relative), JSON.stringify(data))
      return relative
    },
  }),
}))
jest.mock('../long-take/common', () => ({
  ...jest.requireActual('../long-take/common'),
  withActivityHeartbeat: (fn: () => unknown) => fn(),
  withLongTakeContext: (_context: unknown, fn: () => unknown) => fn(),
}))
jest.mock('../long-take/audio', () => ({ generateLongTakeVoiceoverM4a: async () => undefined }))
/** Seconds of "speech" each line's TTS returns, by its text. */
const speechSeconds = new Map<string, number>()
const tts = jest.fn()
jest.mock('@agent-lib/agents/story-loader/voice-tools/utils/provider-tts.util', () => ({
  generateTTSAudio: async (text: string, voiceId: string, model: string, provider: string) => {
    tts({ model, provider, text, voiceId })
    return { audioBuffer: speechWav(speechSeconds.get(text) ?? 2.6) }
  },
  resolveTtsModel: () => 'kokoro-en',
  resolveVoiceRoute: async (voiceId: string) => ({ provider: 'kokoro', voiceId }),
}))
const align = jest.fn()
jest.mock('@reelmakeeasy/common/asr/elevenlabs', () => ({
  generateForcedAlignment: (audioPath: string, text: string) => align(audioPath, text),
}))
/** The engines the local voice server runs (none: no free voice is installed). */
const localEngines = { kokoro: false, qwen3: false }
jest.mock('@reelmakeeasy/common/tts/local-tts', () => ({
  ...jest.requireActual('@reelmakeeasy/common/tts/local-tts'),
  localTtsHealth: async () => ({ backend: 'mlx', engines: localEngines }),
  localTtsSupports: async (engine: 'kokoro' | 'qwen3') => localEngines[engine],
}))

import { checkBeatLoopLines } from '@agent-lib/agents/story-loader/voice-tools/utils/beat-loop-lines.util'
import { accentWordIndex } from '@reelmakeeasy/common/long-take/beat-loop-captions'

import { fitBeatLoopLine, generateBeatLoopVoiceover } from './voiceover'

/** 0.2 s of silence, a 440 Hz tone for `seconds`, 0.3 s of silence, as 24 kHz mono WAV. */
function duration(file: string): number {
  return Number(
    execFileSync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      file,
    ]).toString(),
  )
}

/** 0 s of "speech": a second of silence, as a voice that said nothing sends back. */
function speechWav(seconds: number): Buffer {
  // A WAV header with no samples: audio a voice sent back that FFmpeg can't measure.
  if (seconds < 0) {
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
  const file = path.join(root, `tts-${seconds}-${Math.random().toString(36).slice(2)}.wav`)
  const input = seconds
    ? ['-i', `sine=frequency=440:sample_rate=24000:duration=${seconds}`]
    : ['-i', 'anullsrc=r=24000:cl=mono', '-t', '1']
  const pad = seconds ? ['-af', 'adelay=200,apad=pad_dur=0.3'] : []
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', ...input, ...pad, '-ac', '1', file])
  return fs.readFileSync(file)
}

/** Where the sound starts after `fromS` (first sample over -30 dBFS), decoded at 48 kHz. */
function soundStartAfter(file: string, fromS: number): number {
  const pcm = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', '48000', '-'],
    { maxBuffer: 64 * 1024 * 1024 },
  )
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4)
  for (let i = Math.round(fromS * 48_000); i < samples.length; i++) {
    if (Math.abs(samples[i]) > 0.03) return i / 48_000
  }
  return Number.NaN
}

const NARRATION = [
  'Cleopatra lived closer to the Moon landing than the pyramids.',
  'The Great Pyramid was finished around twenty-five sixty B.C.',
  'Cleopatra was born in sixty-nine B.C., much later than that.',
  'So Egypt was ancient even to its own famous queens.',
]

const storyboard: BeatLoopStoryboard = {
  accent: '#FFE500',
  caption_style: 'explainer',
  clips: NARRATION.map((narration, i) => ({
    caption: i === 1 ? 'The Great Pyramid was finished around 2560 BC.' : null,
    cut: 'The camera dives into the next cutout.',
    cut_camera: 'Zoom in' as const,
    freeze: 'The cutouts freeze on the page.',
    hit: 'The cutouts slam into place.',
    hit_camera: 'Push in' as const,
    id: `s${i + 1}`,
    narration,
    stamp: null,
  })),
  duration_s: 16,
  keyframes: Array.from({ length: 4 }, (_, i) => ({ id: `f${i}`, prompt: `Shot ${i}` })),
  sources: 'A source',
  title: 'Loop',
}

/** The aligner's words: the script's words laid evenly over the line's audio. */
function evenWords(audioPath: string, text: string) {
  const words = text.split(/\s+/)
  const step = duration(audioPath) / words.length
  return {
    characters: [],
    source: 'local-aligner',
    words: words.map((word, i) => ({ end: (i + 0.9) * step, start: i * step, text: word })),
  }
}

const dataDirBefore = process.env['DATA_DIR']
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'beat-loop-voice-'))
  // Each test keeps its lines' audio in its own data folder.
  process.env['DATA_DIR'] = root
  localEngines.kokoro = false
  localEngines.qwen3 = false
  speechSeconds.clear()
  tts.mockClear()
  align.mockReset()
  align.mockImplementation(async (audioPath: string, text: string) => evenWords(audioPath, text))
})
afterEach(() => {
  fs.rmSync(root, { force: true, recursive: true })
  if (dataDirBefore === undefined) delete process.env['DATA_DIR']
  else process.env['DATA_DIR'] = dataDirBefore
})

const params = { projectId: 'p1', storyboard, userId: 'u1', voiceId: 'kokoro-af_heart' }

describe('fitBeatLoopLine', () => {
  it('leaves a line that fits the 3.45 s between 0.15 s and 3.6 s alone', () => {
    expect(fitBeatLoopLine(3.45)).toEqual({ fits: true, tempo: 1 })
  })

  it('speeds a long line up to 1.3x at most', () => {
    expect(fitBeatLoopLine(3.9)).toEqual({ fits: true, tempo: 3.9 / 3.45 })
    expect(fitBeatLoopLine(3.45 * 1.3)).toMatchObject({ fits: true })
    expect(fitBeatLoopLine(3.45 * 1.31)).toMatchObject({ fits: false })
  })
})

describe('generateBeatLoopVoiceover', () => {
  it('speaks one line per clip, each 0.15 s into its clip, on a track of N x 4 s', async () => {
    speechSeconds.set(NARRATION[2], 3.9)
    const result = await generateBeatLoopVoiceover(params)

    expect(tts.mock.calls.map(([call]) => call.text)).toEqual(NARRATION)
    expect(tts.mock.calls[0][0]).toMatchObject({ provider: 'kokoro', voiceId: 'kokoro-af_heart' })
    const voice = path.join(root, result.voiceOverPath)
    expect(result.voiceOverPath).toBe('story_loader/audio/voice_over.mp3')
    expect(duration(voice)).toBeCloseTo(16, 1)
    for (let k = 0; k < 4; k++) {
      expect(soundStartAfter(voice, k * 4)).toBeCloseTo(k * 4 + 0.15, 1)
    }
    expect(result.lines.map((line) => line.tempo)).toEqual([1, 1, expect.any(Number), 1])
    expect(result.lines[2].tempo).toBeCloseTo(3.9 / 3.45, 3)
    // The sped-up line still ends before 3.6 s of its clip.
    expect(result.lines[2].speechSeconds / result.lines[2].tempo).toBeCloseTo(3.45, 3)
  })

  it('reuses the lines make_beat_loop already said in this voice: none is paid for twice', async () => {
    speechSeconds.set(NARRATION[2], 3.9)
    const check = await checkBeatLoopLines({
      clips: storyboard.clips,
      voiceId: 'kokoro-af_heart',
    })
    expect(check.lines.every((line) => line.fits)).toBe(true)
    expect(tts).toHaveBeenCalledTimes(4)

    const result = await generateBeatLoopVoiceover(params)

    expect(tts).toHaveBeenCalledTimes(4)
    // The run measured the very audio the check did.
    expect(result.lines.map((line) => line.speechSeconds)).toEqual(
      check.lines.map((line) => expect.closeTo(line.seconds, 2)),
    )
  })

  it('speaks with a free local voice when none is named and one is installed', async () => {
    localEngines.kokoro = true
    await generateBeatLoopVoiceover({ ...params, voiceId: undefined })
    expect(tts.mock.calls[0][0]).toMatchObject({ provider: 'kokoro', voiceId: 'kokoro-af_heart' })
  })

  it("times each line's words on its own audio and shifts them onto the clip grid", async () => {
    const result = await generateBeatLoopVoiceover(params)
    expect(align).toHaveBeenCalledTimes(4)
    expect(result.lines.every((line) => line.timing.source === 'aligner')).toBe(true)

    const transcript = JSON.parse(
      fs.readFileSync(path.join(root, result.transcriptPath), 'utf8'),
    ) as TranscriptData
    expect(result.transcriptPath).toBe('story_loader/transcript/transformed_transcript.json')
    expect(transcript.language).toBe('en')
    // Line 2's first chunk starts on its first word, 0.15 s into clip 2.
    const clip2 = transcript.segments.filter((s) => s.start >= 4 && s.start < 8)
    expect(clip2[0].start).toBeCloseTo(4.15, 2)
    expect(clip2.at(-1)?.end).toBe(8)
    // Clip 2 shows its caption, not the spoken numbers.
    expect(clip2.map((s) => s.text).join(' ')).toBe(
      'The Great Pyramid was finished around 2560 BC.',
    )
    expect(transcript.segments.every((s) => s.words.length >= 1 && s.words.length <= 3)).toBe(true)
    expect(fs.readFileSync(path.join(root, 'story_loader/script.txt'), 'utf8')).toBe(
      NARRATION.join('\n'),
    )
  })

  it('marks each chunk as its own caption, held for its window, with its accent word', async () => {
    const result = await generateBeatLoopVoiceover(params)

    const transcript = JSON.parse(
      fs.readFileSync(path.join(root, result.transcriptPath), 'utf8'),
    ) as TranscriptData
    expect(transcript.captionWindows).toBe('segment')
    for (const segment of transcript.segments) {
      const accented = segment.words.flatMap((word, i) => (word.accent ? [i] : []))
      expect(accented).toEqual([accentWordIndex(segment.words.map((word) => word.word))])
      expect(segment.words.every((word) => word.accent === undefined || word.accent)).toBe(true)
    }
    // The transcript carries the chunks: no separate caption file is written.
    expect(result).not.toHaveProperty('captionsPath')
    expect(fs.existsSync(path.join(root, 'long_take/beat_loop_captions.json'))).toBe(false)
  })

  it('hands a delivery tag to the voice, but never times or captions it', async () => {
    const tagged = `[excited] ${NARRATION[0]}`
    const clips = storyboard.clips.map((clip, i) => (i ? clip : { ...clip, narration: tagged }))
    const result = await generateBeatLoopVoiceover({
      ...params,
      storyboard: { ...storyboard, clips },
    })

    expect(tts.mock.calls[0][0].text).toBe(tagged)
    expect(align.mock.calls[0][1]).toBe(NARRATION[0])
    expect(result.lines[0].words.map((word) => word.text).join(' ')).toBe(NARRATION[0])
    const transcript = JSON.parse(
      fs.readFileSync(path.join(root, result.transcriptPath), 'utf8'),
    ) as TranscriptData
    expect(transcript.segments.map((s) => s.text).join(' ')).not.toMatch(/excited|\[/)
  })

  it('still times the words, from the pauses, when no aligner can run', async () => {
    align.mockRejectedValue(new Error('no backend'))
    const result = await generateBeatLoopVoiceover(params)
    expect(result.lines.every((line) => line.timing.source === 'fallback')).toBe(true)
    const transcript = JSON.parse(
      fs.readFileSync(path.join(root, result.transcriptPath), 'utf8'),
    ) as TranscriptData
    expect(transcript.segments[0].start).toBeGreaterThanOrEqual(0.15)
  })

  it('names a line the voice said nothing for, and says it again on the next run', async () => {
    speechSeconds.set(NARRATION[1], 0)
    const error = await generateBeatLoopVoiceover(params).catch((e: unknown) => e)
    expect(error).toMatchObject({ nonRetryable: true, type: 'BeatLoopSilentLine' })
    expect((error as Error).message).toBe('The voice came back silent for clip s2')

    speechSeconds.delete(NARRATION[1])
    tts.mockClear()
    await generateBeatLoopVoiceover(params)
    // The silent line was not kept; the first one was.
    expect(tts.mock.calls.map(([call]) => call.text)).toEqual(NARRATION.slice(1))
  })

  it("says a line again on the next try when its audio can't be measured", async () => {
    speechSeconds.set(NARRATION[1], -1)
    await expect(generateBeatLoopVoiceover(params)).rejects.toThrow()

    speechSeconds.delete(NARRATION[1])
    tts.mockClear()
    await generateBeatLoopVoiceover(params)
    // The unreadable line was not kept; the first one was.
    expect(tts.mock.calls.map(([call]) => call.text)).toEqual(NARRATION.slice(1))
  })

  it('fails before any picture is made, naming every line too long even at 1.3x', async () => {
    speechSeconds.set(NARRATION[1], 4.8)
    speechSeconds.set(NARRATION[3], 5.2)
    const error = await generateBeatLoopVoiceover(params).catch((e: unknown) => e)
    expect(error).toMatchObject({ nonRetryable: true, type: 'BeatLoopLineTooLong' })
    const message = (error as Error).message
    expect(message).toMatch(/clip 2 \(s2\)/)
    expect(message).toMatch(/clip 4 \(s4\)/)
    expect(message).not.toMatch(/clip 1 /)
    // By how much, so the fix is clear: 4.49 s fits a line at most (3.45 s at 1.3x).
    expect(message).toMatch(
      /clip 2 \(s2\) takes 4\.\d s to say, 0\.\d s more than fits \(cut about 1 word;/,
    )
    expect(message).toMatch(
      /clip 4 \(s4\) takes 5\.\d s to say, 0\.\d s more than fits \(cut about 2 words;/,
    )
    expect(message).toMatch(/4\.5 s at most/)
    expect(message).toMatch(/twenty-five sixty/)
    expect(message).toMatch(
      /takes 4\.8 s to say, .*; it would need 1\.39x, aim for about \d+ short words\): "/,
    )
    expect(fs.existsSync(path.join(root, 'story_loader/audio/voice_over.mp3'))).toBe(false)
  })
})
