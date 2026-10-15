import { AUDIO_READY_MAX_WAIT_MS, isAudioReadyLine, shouldAutoPlay } from './audio-ready'

describe('isAudioReadyLine', () => {
  it('spots the engine line logged when its audio node is up', () => {
    expect(isAudioReadyLine('322322 AudioWorkletProcessorCreated')).toBe(true)
    expect(isAudioReadyLine('[x] 322322 AudioWorkletProcessorCreated ')).toBe(true)
    expect(isAudioReadyLine('322322 AudioThreadInitialized')).toBe(false)
    expect(isAudioReadyLine('AudioQueueFull')).toBe(false)
    expect(isAudioReadyLine(undefined)).toBe(false)
  })
})

describe('shouldAutoPlay', () => {
  const base = { audioReady: false, autoPlay: true, readyForPlay: true, waitedMs: 0 }

  it('waits for the first frame and for the audio', () => {
    expect(shouldAutoPlay({ ...base, readyForPlay: false, audioReady: true })).toBe(false)
    expect(shouldAutoPlay(base)).toBe(false)
    expect(shouldAutoPlay({ ...base, audioReady: true })).toBe(true)
  })

  it('plays anyway once the audio wait runs out, and never without autoPlay', () => {
    expect(shouldAutoPlay({ ...base, waitedMs: AUDIO_READY_MAX_WAIT_MS })).toBe(true)
    expect(shouldAutoPlay({ ...base, audioReady: true, autoPlay: false })).toBe(false)
  })
})
