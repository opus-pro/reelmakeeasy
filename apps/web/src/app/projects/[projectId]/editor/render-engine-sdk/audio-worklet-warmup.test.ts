import {
  type AudioWorkletWarmupDeps,
  parkedAudioContextCount,
  resetAudioWorkletWarmupForTest,
  warmUpAudioWorklet,
} from './audio-worklet-warmup'

/** A context whose worklet loads the module only from the `workingFrom`-th context on. */
function fakeDeps(workingFrom: number, over: Partial<AudioWorkletWarmupDeps> = {}) {
  const contexts: { close: jest.Mock; suspend: jest.Mock }[] = []
  const revoke = jest.fn()
  const logWarn = jest.fn()
  const deps: AudioWorkletWarmupDeps = {
    createContext: () => {
      const n = contexts.length + 1
      const ctx = {
        audioWorklet: {
          addModule: jest.fn(() =>
            n >= workingFrom ? Promise.resolve() : new Promise<void>(() => undefined),
          ),
        },
        close: jest.fn(),
        suspend: jest.fn(async () => undefined),
      }
      contexts.push(ctx)
      return ctx as never
    },
    logWarn,
    maxContexts: 8,
    moduleUrl: () => ({ revoke, url: 'blob:probe' }),
    probeMs: 5,
    supported: () => true,
    ...over,
  }
  return { contexts, deps, logWarn, revoke }
}

describe('warmUpAudioWorklet', () => {
  beforeEach(() => resetAudioWorkletWarmupForTest())

  it('uses up the stuck contexts until one loads the module, and parks them all', async () => {
    const { contexts, deps, revoke } = fakeDeps(5)
    expect(await warmUpAudioWorklet(deps)).toBe(5)
    expect(contexts).toHaveLength(5)
    expect(parkedAudioContextCount()).toBe(5)
    // Parked, never closed: closing one frees its thread and the next context sticks again.
    for (const c of contexts) {
      expect(c.suspend).toHaveBeenCalled()
      expect(c.close).not.toHaveBeenCalled()
    }
    expect(revoke).toHaveBeenCalled()
  })

  it('costs one context where the first one works', async () => {
    const { contexts, deps } = fakeDeps(1)
    expect(await warmUpAudioWorklet(deps)).toBe(1)
    expect(contexts).toHaveLength(1)
  })

  it('stops at the cap and says so when no context ever works', async () => {
    const { contexts, deps, logWarn } = fakeDeps(99, { maxContexts: 3 })
    expect(await warmUpAudioWorklet(deps)).toBe(3)
    expect(contexts).toHaveLength(3)
    expect(logWarn).toHaveBeenCalled()
  })

  it('runs once per page', async () => {
    const { contexts, deps } = fakeDeps(2)
    const first = warmUpAudioWorklet(deps)
    const second = warmUpAudioWorklet(deps)
    expect(second).toBe(first)
    await first
    expect(contexts).toHaveLength(2)
  })

  it('does nothing where AudioWorklet is unsupported', async () => {
    const { contexts, deps } = fakeDeps(1, { supported: () => false })
    expect(await warmUpAudioWorklet(deps)).toBe(0)
    expect(contexts).toHaveLength(0)
  })
})
