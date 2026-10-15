import { writeFile } from 'node:fs/promises'

import type { TranscriptData } from '@shared/types/agent/transcript'

const mockPerformAsr = jest.fn()
const mockRetime = jest.fn()
const mockFidelity = jest.fn()
const written = new Map<string, unknown>()

jest.mock('./audio-transcript-recovery', () => ({
  performAsrAndDeriveScript: (...args: unknown[]) => mockPerformAsr(...args),
  retimeTranscriptOnScript: (...args: unknown[]) => mockRetime(...args),
}))
jest.mock('@agent-lib/agents/story-loader/voice-tools/utils/transcript-fidelity.util', () => ({
  checkTranscriptFidelity: (...args: unknown[]) => mockFidelity(...args),
}))
jest.mock('@reelmakeeasy/common/utils/transcode-audio', () => ({
  transcodeAudioToM4a: async () => true,
}))
jest.mock('./common', () => ({
  ...jest.requireActual('./common'),
  downloadAssetToLocal: async (_uri: string, localPath: string) => writeFile(localPath, 'mp3'),
  getVideoDurationSeconds: async () => 5.7,
  withActivityHeartbeat: (fn: () => Promise<unknown>) => fn(),
}))
jest.mock('./storage', () => ({
  ...jest.requireActual('./storage'),
  createLongTakeStorage: () => ({
    ensureDir: async () => undefined,
    getFullPath: (file: string) => `/data/${file}`,
    uploadFile: async () => undefined,
    writeFile: async (file: string, data: unknown) => written.set(file, data),
    writeJsonFile: async (file: string, data: unknown) => written.set(file, data),
  }),
}))

import { STORY_LOADER_PATHS } from '@reelmakeeasy/common/agent-v2/paths'

import { generateLongTakeVoiceover } from './audio'

const SCRIPT = 'Older than trees. Really old.'
const segment = (text: string, start: number, end: number) => ({
  end,
  start,
  text,
  words: text.split(' ').map((word) => ({ end, speaker: null, start, word })),
})
const asrTranscript: TranscriptData = {
  language: 'eng',
  segments: [segment('older then trees really old', 0, 5)],
}
const timedTranscript: TranscriptData = {
  language: 'eng',
  segments: [segment('Older than trees.', 0.4, 1.9), segment('Really old.', 3.7, 4.8)],
}

beforeEach(() => {
  jest.resetAllMocks()
  written.clear()
  mockPerformAsr.mockResolvedValue({
    scriptSource: 'asr',
    scriptText: 'older then trees really old',
    transcriptData: asrTranscript,
  })
  mockFidelity.mockReturnValue({ isValid: true, issues: [] })
  mockRetime.mockResolvedValue(timedTranscript)
})

const run = (audioSource: 'tts_preview' | 'user_upload') =>
  generateLongTakeVoiceover({
    audioPath: 'uploads/take.mp3',
    audioSource,
    confirmedScript: SCRIPT,
    projectId: 'p1',
    userId: 'u1',
  } as Parameters<typeof generateLongTakeVoiceover>[0])

describe('generateLongTakeVoiceover caption timing for handed-over audio', () => {
  it('times a preview take that passed the fidelity check from the confirmed script', async () => {
    await run('tts_preview')

    expect(mockPerformAsr).toHaveBeenCalledWith(expect.any(String), SCRIPT, 'p1', 5.7)
    expect(mockRetime).toHaveBeenCalledWith({
      durationSeconds: 5.7,
      language: 'eng',
      localAudioPath: mockPerformAsr.mock.calls[0]?.[0],
      projectId: 'p1',
      script: SCRIPT,
    })
    expect(written.get(STORY_LOADER_PATHS.transformedTranscriptPath)).toBe(timedTranscript)
  })

  it("keeps the ASR transcript when captions aren't timed on this computer", async () => {
    mockRetime.mockResolvedValue(null)

    await run('tts_preview')

    expect(written.get(STORY_LOADER_PATHS.transformedTranscriptPath)).toBe(asrTranscript)
  })

  it("keeps the ASR words of a user's own recording, which can differ from the script", async () => {
    await run('user_upload')

    expect(mockRetime).not.toHaveBeenCalled()
    expect(written.get(STORY_LOADER_PATHS.transformedTranscriptPath)).toBe(asrTranscript)
  })
})
