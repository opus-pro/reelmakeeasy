import { BGM_DEFAULT_VOLUME } from '@reelmakeeasy/common/long-take/bgm-volume'
import { act, renderHook } from '@testing-library/react'

const mockFetchApiDomain = jest.fn()
jest.mock('@/hooks/useApi', () => ({ useApi: () => ({ fetchApiDomain: mockFetchApiDomain }) }))
jest.mock('@shared/ui', () => ({ toast: { error: jest.fn() } }))

import { getDefaultStore } from 'jotai'

import { renderedVersionsAtom } from '@/components/agent/renderedVersions'

import { musicVolumeDraftAtom, useLiveMusicVolume, useMusicToggle } from './useMusicToggle'

/** Answers bgm-settings reads from `reads` in order (the last one repeats); writes succeed. */
function serve(reads: Record<string, unknown>[]) {
  let i = 0
  mockFetchApiDomain.mockImplementation(async (path: string, opts: { method: string }) => {
    if (opts.method === 'GET' && path.endsWith('/bgm-settings')) {
      const data = reads[Math.min(i, reads.length - 1)]
      i += 1
      return { data: { data }, ok: true }
    }
    return { data: { data: {} }, ok: true }
  })
}

const flush = async (ms = 0) => {
  await act(async () => {
    jest.advanceTimersByTime(ms)
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useMusicToggle', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockFetchApiDomain.mockReset()
  })
  afterEach(() => jest.useRealTimers())

  it('follows a change already running on the server, with its label, to the end', async () => {
    serve([
      { generating: true },
      { generating: true },
      { generating: false, regenOutcome: 'completed' },
    ])
    const onChanged = jest.fn()
    const { result } = renderHook(() =>
      useMusicToggle('p1', { bgmEnabled: true, delivered: true, hasBed: true, onChanged }),
    )
    await flush()
    expect(result.current.busy).toBe(true)
    expect(result.current.busyLabel).toBe('Generating music…')
    await flush(3000)
    await flush(3000)
    expect(result.current.busy).toBe(false)
    expect(result.current.busyLabel).toBeNull()
    expect(onChanged).toHaveBeenCalled()
  })

  it('stays idle when nothing is running', async () => {
    serve([{ applying: false, generating: false }])
    const { result } = renderHook(() =>
      useMusicToggle('p1', { bgmEnabled: true, delivered: true, hasBed: true }),
    )
    await flush()
    expect(result.current.busy).toBe(false)
    expect(result.current.busyLabel).toBeNull()
  })

  it('labels a change it starts while it runs', async () => {
    serve([{}, { generating: true }, { generating: false, regenOutcome: 'completed' }])
    const { result } = renderHook(() =>
      useMusicToggle('p1', { bgmEnabled: true, delivered: true, hasBed: true }),
    )
    await flush()
    let pending: Promise<void> = Promise.resolve()
    await act(async () => {
      pending = result.current.applyRequest({ choice: 'upbeat' })
      await Promise.resolve()
    })
    expect(result.current.busy).toBe(true)
    expect(result.current.busyLabel).toBe('Generating music…')
    await flush(3000)
    await flush(3000)
    await act(async () => {
      await pending
    })
    expect(result.current.busyLabel).toBeNull()
  })

  it('previews a new volume at once, saves it on release, and labels the change', async () => {
    serve([{}, { applying: true }, { applying: false, remuxOutcome: 'completed' }])
    const { result } = renderHook(() => ({
      live: useLiveMusicVolume('p1', 90),
      toggle: useMusicToggle('p1', { bgmEnabled: true, delivered: true, hasBed: true }),
    }))
    await flush()
    act(() => result.current.toggle.previewVolume(60))
    expect(result.current.live).toBe(60)
    let pending: Promise<void> = Promise.resolve()
    await act(async () => {
      pending = result.current.toggle.setVolume(60)
      await Promise.resolve()
    })
    expect(mockFetchApiDomain).toHaveBeenCalledWith('/api/long-take-videos/p1/bgm-settings', {
      data: { bgmVolume: 60 },
      method: 'PUT',
    })
    expect(result.current.toggle.busyLabel).toBe('Updating the volume…')
    await flush(3000)
    await flush(3000)
    await act(async () => {
      await pending
    })
    expect(result.current.toggle.busy).toBe(false)
  })

  it('drops the previewed volume when saving it fails', async () => {
    serve([{}, { applying: false, remuxOutcome: 'failed' }])
    const { result } = renderHook(() => ({
      live: useLiveMusicVolume('p2', 90),
      toggle: useMusicToggle('p2', { bgmEnabled: true, delivered: true, hasBed: true }),
    }))
    await flush()
    act(() => result.current.toggle.previewVolume(30))
    let pending: Promise<void> = Promise.resolve()
    await act(async () => {
      pending = result.current.toggle.setVolume(30)
      await Promise.resolve()
    })
    await flush(3000)
    await act(async () => {
      await pending
    })
    expect(result.current.live).toBe(90)
  })

  it('two controls for one video share the running change, and the second cannot start another', async () => {
    // Each control asks once on mount (two idle answers), then the change runs.
    serve([
      {},
      {},
      { applying: true },
      { applying: true },
      { applying: false, remuxOutcome: 'completed' },
    ])
    const { result } = renderHook(() => ({
      a: useMusicToggle('s1', { bgmEnabled: true, delivered: true, hasBed: true }),
      b: useMusicToggle('s1', { bgmEnabled: true, delivered: true, hasBed: true }),
    }))
    await flush()
    await act(async () => {
      void result.current.a.setMusicOn(false)
      await Promise.resolve()
    })
    expect(result.current.b.busy).toBe(true)
    expect(result.current.b.busyLabel).toBe('Removing the music…')
    expect(result.current.b.musicOn).toBe(false)
    const puts = () => mockFetchApiDomain.mock.calls.filter(([, o]) => o.method === 'PUT').length
    await act(async () => {
      await result.current.b.setMusicOn(true)
    })
    expect(puts()).toBe(1)
    await flush(3000)
    await flush(3000)
    await flush(3000)
    expect(result.current.a.busy).toBe(false)
    expect(result.current.b.busy).toBe(false)
  })

  it('picks up a change started elsewhere (the chat) while the page is open', async () => {
    serve([{}, {}, { generating: true }, { generating: false, regenOutcome: 'completed' }])
    const { result } = renderHook(() =>
      useMusicToggle('s2', { bgmEnabled: true, delivered: true, hasBed: true }),
    )
    await flush()
    expect(result.current.busy).toBe(false)
    await flush(6000)
    await flush(6000)
    expect(result.current.busy).toBe(true)
    expect(result.current.busyLabel).toBe('Generating music…')
    await flush(3000)
    expect(result.current.busy).toBe(false)
  })

  it('queues a new level while the volume is being saved, and saves the last one after', async () => {
    serve([{}, { applying: true }, { applying: false, remuxOutcome: 'completed' }])
    const { result } = renderHook(() =>
      useMusicToggle('s3', { bgmEnabled: true, bgmVolume: 90, delivered: true, hasBed: true }),
    )
    await flush()
    await act(async () => {
      void result.current.setVolume(60)
      await Promise.resolve()
    })
    expect(result.current.volumeLocked).toBe(false)
    await act(async () => {
      await result.current.setVolume(50)
    })
    await flush(3000)
    await flush(3000)
    await flush(3000)
    await flush(3000)
    const levels = mockFetchApiDomain.mock.calls
      .filter(([, o]) => o.method === 'PUT')
      .map(([, o]) => o.data.bgmVolume)
    expect(levels).toEqual([60, 50])
  })

  it('a failed volume save puts the previous level back', async () => {
    serve([{}, { applying: false, remuxOutcome: 'failed' }])
    const { result } = renderHook(() =>
      useMusicToggle('s4', { bgmEnabled: true, bgmVolume: 80, delivered: true, hasBed: true }),
    )
    await flush()
    await act(async () => {
      void result.current.setVolume(40)
      await Promise.resolve()
    })
    await flush(3000)
    const levels = mockFetchApiDomain.mock.calls
      .filter(([, o]) => o.method === 'PUT')
      .map(([, o]) => o.data.bgmVolume)
    expect(levels).toEqual([40, 80])
  })

  it('a volume change does not reload a live preview; other changes do', async () => {
    serve([{}, { applying: false, remuxOutcome: 'completed' }])
    const { result } = renderHook(() =>
      useMusicToggle('s5', { bgmEnabled: true, bgmVolume: 90, delivered: true, hasBed: true }),
    )
    await flush()
    await act(async () => {
      void result.current.setVolume(70)
      await Promise.resolve()
    })
    await flush(3000)
    expect(getDefaultStore().get(renderedVersionsAtom).s5).toBeUndefined()
    await act(async () => {
      void result.current.setMusicOn(false)
      await Promise.resolve()
    })
    await flush(3000)
    expect(getDefaultStore().get(renderedVersionsAtom).s5).toBe(1)
  })

  it('drops a draft at the default level when nothing was ever saved', async () => {
    serve([{}])
    const { result } = renderHook(() => ({
      live: useLiveMusicVolume('s6', null),
      toggle: useMusicToggle('s6', { bgmEnabled: true, delivered: true, hasBed: true }),
    }))
    await flush()
    act(() => result.current.toggle.previewVolume(BGM_DEFAULT_VOLUME))
    await flush()
    act(() => result.current.toggle.previewVolume(70))
    expect(result.current.live).toBe(70)
    act(() => result.current.toggle.previewVolume(BGM_DEFAULT_VOLUME))
    await flush()
    expect(Object.keys(getDefaultStore().get(musicVolumeDraftAtom))).not.toContain('s6')
  })
})
