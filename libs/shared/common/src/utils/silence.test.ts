import {
  CAPTION_PAUSE,
  detectSilences,
  parseSilenceDetect,
  speechOnset,
  speechSpans,
  splitAtSilences,
} from './silence'

const mockRunCommand = jest.fn()
jest.mock('./cmdline', () => ({
  runCommand: (...args: unknown[]) => mockRunCommand(...args),
}))

/** FFmpeg's stderr for `silencedetect`, as it prints it (a Kokoro line). */
const KOKORO_LINE = `Input #0, wav, from 'L01.wav':
  Duration: 00:00:03.93, bitrate: 256 kb/s
  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 16000 Hz, mono, s16, 256 kb/s
[Parsed_silencedetect_0 @ 0xa99044900] silence_start: 0
[Parsed_silencedetect_0 @ 0xa99044900] silence_end: 0.302 | silence_duration: 0.302
[Parsed_silencedetect_0 @ 0xa99044900] silence_start: 1.630937
[Parsed_silencedetect_0 @ 0xa99044900] silence_end: 1.754687 | silence_duration: 0.12375
[Parsed_silencedetect_0 @ 0xa99044900] silence_start: 3.372438
[Parsed_silencedetect_0 @ 0xa99044900] silence_end: 3.925 | silence_duration: 0.552562
`

describe('parseSilenceDetect', () => {
  it('reads every silence FFmpeg reported', () => {
    expect(parseSilenceDetect(KOKORO_LINE)).toEqual([
      { end: 0.302, start: 0 },
      { end: 1.754687, start: 1.630937 },
      { end: 3.925, start: 3.372438 },
    ])
  })

  it('clamps a start FFmpeg puts just before 0 (it reports -0.0013 on some files)', () => {
    const output = 'silence_start: -0.00133\nsilence_end: 0.25 | silence_duration: 0.25133\n'
    expect(parseSilenceDetect(output)).toEqual([{ end: 0.25, start: 0 }])
  })

  it('closes a silence still open at the end of the audio at its duration', () => {
    const output = 'silence_start: 0\nsilence_end: 0.3\nsilence_start: 2.5\n'
    expect(parseSilenceDetect(output, 3.1)).toEqual([
      { end: 0.3, start: 0 },
      { end: 3.1, start: 2.5 },
    ])
  })

  it('uses the Duration line when the caller does not know the length', () => {
    const output = '  Duration: 00:01:02.50, bitrate: 128 kb/s\nsilence_start: 61.9\n'
    expect(parseSilenceDetect(output)).toEqual([{ end: 62.5, start: 61.9 }])
  })

  it('drops an open silence when the length is unknown, and a stray end', () => {
    expect(parseSilenceDetect('silence_end: 0.4\nsilence_start: 1.2\n')).toEqual([])
  })

  it('drops a silence that ends before it starts', () => {
    const output = 'silence_start: 1.5\nsilence_end: 1.2\nsilence_start: 2\nsilence_end: 2.4\n'
    expect(parseSilenceDetect(output)).toEqual([{ end: 2.4, start: 2 }])
  })
})

describe('detectSilences', () => {
  beforeEach(() => mockRunCommand.mockReset())

  it('runs silencedetect with the caption pause settings and parses stderr', async () => {
    mockRunCommand.mockResolvedValue({ stderr: KOKORO_LINE, stdout: '' })
    const report = await detectSilences('/tmp/line.wav', CAPTION_PAUSE)
    expect(mockRunCommand).toHaveBeenCalledWith([
      'ffmpeg',
      '-hide_banner',
      '-nostats',
      '-i',
      '/tmp/line.wav',
      '-af',
      'silencedetect=noise=-35dB:d=0.12',
      '-f',
      'null',
      '-',
    ])
    expect(report.durationSeconds).toBe(3.93)
    expect(report.silences).toHaveLength(3)
  })

  it('prefers the duration the caller measured', async () => {
    mockRunCommand.mockResolvedValue({ stderr: 'silence_start: 2\n', stdout: '' })
    const report = await detectSilences('/tmp/a.mp3', {
      durationSeconds: 2.75,
      minSeconds: 0.03,
      noiseDb: -50,
    })
    expect(mockRunCommand.mock.calls[0]?.[0]).toContain('silencedetect=noise=-50dB:d=0.03')
    expect(report).toEqual({ durationSeconds: 2.75, silences: [{ end: 2.75, start: 2 }] })
  })
})

describe('speechSpans', () => {
  it('is the audio between the silences', () => {
    expect(speechSpans(parseSilenceDetect(KOKORO_LINE), 3.925)).toEqual([
      { end: 1.630937, start: 0.302 },
      { end: 3.372438, start: 1.754687 },
    ])
  })

  it('is the whole audio when there is no silence', () => {
    expect(speechSpans([], 2)).toEqual([{ end: 2, start: 0 }])
  })

  it('sorts and merges overlapping silences, and stays inside the audio', () => {
    const silences = [
      { end: 2.2, start: 1.9 },
      { end: 0.5, start: -0.1 },
      { end: 2, start: 1.8 },
      { end: 9, start: 2.9 },
    ]
    expect(speechSpans(silences, 3)).toEqual([
      { end: 1.8, start: 0.5 },
      { end: 2.9, start: 2.2 },
    ])
  })

  it('drops sounds too short to hold a word', () => {
    const silences = [
      { end: 1, start: 0 },
      { end: 2, start: 1.04 },
    ]
    expect(speechSpans(silences, 3, 0.06)).toEqual([{ end: 3, start: 2 }])
  })
})

describe('speechOnset', () => {
  it('is where the leading silence ends', () => {
    expect(speechOnset(parseSilenceDetect(KOKORO_LINE))).toBe(0.302)
  })

  it('is 0 when the speech starts right away', () => {
    expect(speechOnset([{ end: 1.2, start: 0.9 }])).toBe(0)
    expect(speechOnset([])).toBe(0)
  })
})

describe('splitAtSilences', () => {
  it('keeps short audio in one piece', () => {
    expect(splitAtSilences([], 90, 120)).toEqual([{ end: 90, start: 0 }])
  })

  it('cuts long audio in the middle of the last pause before each limit', () => {
    const silences = [
      { end: 50.4, start: 50 },
      { end: 110.6, start: 110 },
      { end: 200.2, start: 199.8 },
      { end: 260.5, start: 260.1 },
    ]
    expect(splitAtSilences(silences, 293.4, 120)).toEqual([
      { end: 110.3, start: 0 },
      { end: 200, start: 110.3 },
      { end: 293.4, start: 200 },
    ])
  })

  it('cuts at the limit when there is no pause to cut at', () => {
    expect(splitAtSilences([], 250, 120)).toEqual([
      { end: 120, start: 0 },
      { end: 240, start: 120 },
      { end: 250, start: 240 },
    ])
  })
})
