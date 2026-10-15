import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { getDefaultStore } from 'jotai'
import type { ReactNode } from 'react'

const mockFetchApiDomain = jest.fn()
const mockToastError = jest.fn()
jest.mock('@/hooks/useApi', () => ({ useApi: () => ({ fetchApiDomain: mockFetchApiDomain }) }))
jest.mock('@shared/ui', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}))

import {
  commitRenderSettingsBaselineAtom,
  renderSettingsAtom,
  renderSettingsChangedAtom,
  seedRenderSettingsProjectAtom,
} from '@/atom/longtake-history.store'

import {
  CAPTION_SAVE_DEBOUNCE_MS,
  useCaptionSettings,
  useCaptionStyleRenderSync,
  useDeliveredCaptionLookDiffers,
  useLiveCaptionStyle,
} from './useCaptionSettings'

type Put = { body: Record<string, unknown>; reject: (e: Error) => void; resolve: () => void }

/**
 * Answers the status read with `status`, and holds every caption-settings PUT until the
 * test settles it; a settled PUT answers with the saved look merged like the endpoint does.
 */
function serve(status: Record<string, unknown>) {
  let saved = (status.captionStyle as null | Record<string, unknown>) ?? {}
  const puts: Put[] = []
  mockFetchApiDomain.mockImplementation(
    (path: string, opts: { data?: Record<string, unknown>; method: string }) => {
      if (opts.method === 'GET') return Promise.resolve({ data: { data: status }, ok: true })
      return new Promise((resolve, reject) => {
        puts.push({
          body: opts.data ?? {},
          reject,
          resolve: () => {
            saved = { ...saved, ...opts.data }
            resolve({ data: { data: { captionStyle: saved } }, ok: true })
          },
        })
      })
    },
  )
  return puts
}

/**
 * Like `serve`, but a status read can be held too (`holdReads`) until `releaseReads`: each
 * answers with the look saved when it was sent, as the server would.
 */
function serveSlowReads(status: Record<string, unknown>) {
  const server = {
    holdReads: false,
    puts: [] as Put[],
    reads: [] as (() => void)[],
    releaseReads: () => server.reads.splice(0).forEach((answer) => answer()),
    saved: (status.captionStyle as null | Record<string, unknown>) ?? {},
  }
  mockFetchApiDomain.mockImplementation(
    (path: string, opts: { data?: Record<string, unknown>; method: string }) => {
      if (opts.method === 'GET') {
        const res = { data: { data: { ...status, captionStyle: { ...server.saved } } }, ok: true }
        if (!server.holdReads) return Promise.resolve(res)
        return new Promise((resolve) => server.reads.push(() => resolve(res)))
      }
      return new Promise((resolve, reject) => {
        server.puts.push({
          body: opts.data ?? {},
          reject,
          resolve: () => {
            server.saved = { ...server.saved, ...opts.data }
            resolve({ data: { data: { captionStyle: server.saved } }, ok: true })
          },
        })
      })
    },
  )
  return server
}

function setup(projectId: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(() => useCaptionSettings(projectId), { wrapper })
}

// Runs the timers due in `ms`, then lets the requests and react-query's batched updates land.
const flush = async (ms = 0) => {
  await act(async () => {
    jest.advanceTimersByTime(ms)
    for (let i = 0; i < 5; i += 1) {
      await Promise.resolve()
      jest.advanceTimersByTime(0)
    }
  })
}

describe('useCaptionSettings', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockFetchApiDomain.mockReset()
    mockToastError.mockReset()
  })
  afterEach(() => jest.useRealTimers())

  it("reads the saved look, the video's kind and the agent's suggestion from the status", async () => {
    serve({ captionAccentSuggestion: '#FF3EA5', captionKind: 'loop', captionStyle: { size: 120 } })
    const { result } = setup('read-1')
    expect(result.current.settled).toBe(false)
    await flush()
    expect(mockFetchApiDomain).toHaveBeenCalledWith('/api/long-take-videos/read-1', {
      method: 'GET',
      noThrowError: true,
    })
    expect(result.current).toMatchObject({
      accentSuggestion: '#FF3EA5',
      kind: 'loop',
      settings: { size: 120 },
      settled: true,
    })
  })

  it('treats a video the status says nothing about as a plain video with nothing chosen', async () => {
    serve({ stage: 'completed' })
    const { result } = setup('read-2')
    await flush()
    expect(result.current).toMatchObject({ accentSuggestion: null, kind: 'video', settings: null })
  })

  it('shows a change at once and saves a burst of changes as one PUT with every field', async () => {
    const puts = serve({ captionKind: 'video', captionStyle: null })
    const { result } = setup('burst')
    await flush()

    act(() => result.current.change({ preset: 'punch' }))
    expect(result.current.settings).toEqual({ preset: 'punch' })
    act(() => result.current.change({ accent: '#FFE500' }))
    await flush(CAPTION_SAVE_DEBOUNCE_MS - 100)
    act(() => result.current.change({ size: 130 }))
    expect(result.current.settings).toEqual({ accent: '#FFE500', preset: 'punch', size: 130 })
    await flush(CAPTION_SAVE_DEBOUNCE_MS - 1)
    expect(puts).toHaveLength(0)

    await flush(1)
    expect(puts.map((p) => p.body)).toEqual([{ accent: '#FFE500', preset: 'punch', size: 130 }])
    expect(mockFetchApiDomain).toHaveBeenCalledWith(
      '/api/long-take-videos/burst/caption-settings',
      {
        data: { accent: '#FFE500', preset: 'punch', size: 130 },
        method: 'PUT',
        noThrowError: true,
      },
    )

    puts[0].resolve()
    await flush()
    expect(result.current.settings).toEqual({ accent: '#FFE500', preset: 'punch', size: 130 })
  })

  it('saves a font in the same PUT as the burst around it, keeps it across styles and clears it', async () => {
    const anton = { family: 'Anton', source: 'pack' } as const
    const roboto = { family: 'Roboto', source: 'pack' } as const
    const puts = serve({ captionKind: 'video', captionStyle: { font: anton } })
    const { result } = setup('font-burst')
    await flush()
    expect(result.current.settings).toEqual({ font: anton })

    act(() => result.current.change({ font: roboto }))
    act(() => result.current.change({ preset: 'punch' }))
    expect(result.current.settings).toEqual({ font: roboto, preset: 'punch' })
    await flush(CAPTION_SAVE_DEBOUNCE_MS)
    expect(puts.map((p) => p.body)).toEqual([{ font: roboto, preset: 'punch' }])
    puts[0].resolve()
    await flush()

    // Another style keeps the font: only the style is sent.
    act(() => result.current.change({ preset: 'explainer' }))
    expect(result.current.settings).toEqual({ font: roboto, preset: 'explainer' })
    await flush(CAPTION_SAVE_DEBOUNCE_MS)
    expect(puts[1].body).toEqual({ preset: 'explainer' })
    puts[1].resolve()
    await flush()
    expect(result.current.settings).toEqual({ font: roboto, preset: 'explainer' })

    // The style default clears it.
    act(() => result.current.change({ font: null }))
    await flush(CAPTION_SAVE_DEBOUNCE_MS)
    expect(puts[2].body).toEqual({ font: null })
    puts[2].resolve()
    await flush()
    expect(result.current.settings).toEqual({ font: null, preset: 'explainer' })
  })

  it('never sends a second save while one is on its way: the changes made meanwhile go next, together', async () => {
    const puts = serve({ captionKind: 'video', captionStyle: null })
    const { result } = setup('one-at-a-time')
    await flush()

    act(() => result.current.change({ preset: 'explainer' }))
    await flush(CAPTION_SAVE_DEBOUNCE_MS)
    expect(puts).toHaveLength(1)

    act(() => result.current.change({ position: 30 }))
    await flush(CAPTION_SAVE_DEBOUNCE_MS)
    act(() => result.current.change({ accent: '#00E5FF' }))
    await flush(CAPTION_SAVE_DEBOUNCE_MS * 3)
    expect(puts).toHaveLength(1)
    expect(result.current.settings).toEqual({
      accent: '#00E5FF',
      position: 30,
      preset: 'explainer',
    })

    puts[0].resolve()
    await flush()
    expect(puts.map((p) => p.body)).toEqual([
      { preset: 'explainer' },
      { accent: '#00E5FF', position: 30 },
    ])
    puts[1].resolve()
    await flush()
    expect(result.current.settings).toEqual({
      accent: '#00E5FF',
      position: 30,
      preset: 'explainer',
    })
  })

  it('shares one save queue between two controls on the same video', async () => {
    const puts = serve({ captionKind: 'video', captionStyle: null })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const chat = renderHook(() => useCaptionSettings('two-controls'), { wrapper })
    const storyboard = renderHook(() => useCaptionSettings('two-controls'), { wrapper })
    await flush()

    act(() => chat.result.current.change({ preset: 'punch' }))
    act(() => storyboard.result.current.change({ size: 80 }))
    expect(storyboard.result.current.settings).toEqual({ preset: 'punch', size: 80 })
    await flush(CAPTION_SAVE_DEBOUNCE_MS)
    expect(puts.map((p) => p.body)).toEqual([{ preset: 'punch', size: 80 }])
  })

  it('puts the look back and says so when a save fails', async () => {
    const puts = serve({ captionKind: 'video', captionStyle: { accent: '#FF8A00' } })
    const { result } = setup('fails')
    await flush()

    act(() => result.current.change({ accent: '#FFE500', preset: 'punch' }))
    await flush(CAPTION_SAVE_DEBOUNCE_MS)
    act(() => result.current.change({ size: 150 }))
    puts[0].reject(new Error('Network Error'))
    await flush()

    expect(result.current.settings).toEqual({ accent: '#FF8A00' })
    expect(mockToastError).toHaveBeenCalledWith(
      'Could not save the caption style. It is back to how it was.',
    )
    // The change made while the failed save was on its way was dropped with it.
    await flush(CAPTION_SAVE_DEBOUNCE_MS * 2)
    expect(puts).toHaveLength(1)
  })

  it('keeps a saved look when a status read sent before the save answers after it', async () => {
    const server = serveSlowReads({ captionKind: 'video', captionStyle: { accent: '#FF8A00' } })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useCaptionSettings('read-before-save'), { wrapper })
    await flush()

    // A render just finished, or a second panel opened: the status is read again, slowly.
    server.holdReads = true
    void client.invalidateQueries()
    await flush()
    act(() => result.current.change({ preset: 'punch' }))
    await flush(CAPTION_SAVE_DEBOUNCE_MS)
    server.puts[0].resolve()
    await flush()
    expect(result.current.settings).toEqual({ accent: '#FF8A00', preset: 'punch' })

    server.releaseReads()
    await flush()
    expect(result.current.settings).toEqual({ accent: '#FF8A00', preset: 'punch' })
  })

  it('keeps a saved look when a status read sent during the save answers after it', async () => {
    const server = serveSlowReads({ captionKind: 'loop', captionStyle: null })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useCaptionSettings('read-during-save'), { wrapper })
    await flush()

    act(() => result.current.change({ size: 130 }))
    await flush(CAPTION_SAVE_DEBOUNCE_MS)
    expect(server.puts).toHaveLength(1)
    server.holdReads = true
    void client.invalidateQueries()
    await flush()
    server.puts[0].resolve()
    await flush()
    server.releaseReads()
    await flush()
    expect(result.current.settings).toEqual({ size: 130 })

    // Later reads see the saved look as usual.
    server.holdReads = false
    await act(() => client.invalidateQueries())
    await flush()
    expect(result.current).toMatchObject({ settings: { size: 130 }, settled: true })
  })

  it('reads the status again after a save that dropped a read, so nothing it brought is lost', async () => {
    const server = serveSlowReads({ captionKind: 'video', captionStyle: null })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useCaptionSettings('read-again'), { wrapper })
    await flush()
    const reads = () => mockFetchApiDomain.mock.calls.filter(([, o]) => o.method === 'GET').length
    expect(reads()).toBe(1)

    server.holdReads = true
    void client.invalidateQueries()
    await flush()
    act(() => result.current.change({ size: 90 }))
    await flush(CAPTION_SAVE_DEBOUNCE_MS)
    server.holdReads = false
    server.puts[0].resolve()
    await flush()
    expect(reads()).toBe(3)
    expect(client.getQueryState(['caption-status', 'read-again'])?.fetchStatus).toBe('idle')
    expect(result.current.settings).toEqual({ size: 90 })
  })

  it("gives the previews the live look and the video's kind", async () => {
    serve({ captionKind: 'loop', captionStyle: { accent: '#FFE500' } })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const panel = renderHook(() => useCaptionSettings('live'), { wrapper })
    const preview = renderHook(() => useLiveCaptionStyle('live'), { wrapper })
    expect(preview.result.current.settled).toBe(false)
    await flush()
    expect(preview.result.current).toEqual({
      kind: 'loop',
      settings: { accent: '#FFE500' },
      settled: true,
    })

    act(() => panel.result.current.change({ preset: 'explainer' }))
    expect(preview.result.current.settings).toEqual({ accent: '#FFE500', preset: 'explainer' })
  })

  it('still lets the previews draw when the status cannot be read', async () => {
    mockFetchApiDomain.mockResolvedValue({ data: null, error: 'Not found', ok: false })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const preview = renderHook(() => useLiveCaptionStyle('unreadable'), { wrapper })
    await flush()
    expect(preview.result.current).toEqual({ kind: 'video', settings: null, settled: true })
  })
})

describe('useCaptionStyleRenderSync', () => {
  const store = getDefaultStore()

  beforeEach(() => {
    jest.useFakeTimers()
    mockFetchApiDomain.mockReset()
  })
  afterEach(() => jest.useRealTimers())

  function setupSync(projectId: string, aspectRatio = '9 / 16') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    store.set(seedRenderSettingsProjectAtom, projectId)
    // Captions on: with them off, only a loop's highlight counts.
    store.set(renderSettingsAtom, (prev) => ({
      ...prev,
      captionEnabled: { latest: true, original: true },
    }))
    const sync = renderHook(() => useCaptionStyleRenderSync(projectId, aspectRatio), { wrapper })
    const panel = renderHook(() => useCaptionSettings(projectId), { wrapper })
    return { client, panel, sync }
  }

  it("compares the delivered file's look with the one the user is looking at", async () => {
    serve({ captionKind: 'loop', captionStyle: { size: 120 }, renderedCaptionStyle: { size: 120 } })
    const { panel } = setupSync('sync-1')
    expect(store.get(renderSettingsAtom).captionStyle.known).toBe(false)
    await flush()
    expect(store.get(renderSettingsAtom).captionStyle).toEqual({
      aspectRatio: '9:16',
      kind: 'loop',
      known: true,
      latest: { size: 120 },
      original: { size: 120 },
    })
    expect(store.get(renderSettingsChangedAtom)).toBe(false)

    act(() => panel.result.current.change({ preset: 'explainer' }))
    await flush()
    expect(store.get(renderSettingsAtom).captionStyle.latest).toEqual({
      preset: 'explainer',
      size: 120,
    })
    expect(store.get(renderSettingsChangedAtom)).toBe(true)
  })

  it('hands Download the font on screen, beside the delivered look', async () => {
    const rendered = { accent: '#04F827', position: null, preset: 'classic', size: 100 }
    serve({ captionKind: 'video', captionStyle: null, renderedCaptionStyle: rendered })
    const { panel } = setupSync('sync-font')
    await flush()
    expect(store.get(renderSettingsAtom).captionStyle).toMatchObject({
      latest: null,
      original: rendered,
    })

    act(() => panel.result.current.change({ font: { family: 'Anton', source: 'pack' } }))
    await flush()
    expect(store.get(renderSettingsAtom).captionStyle).toMatchObject({
      latest: { font: { family: 'Anton', source: 'pack' } },
      original: rendered,
    })
  })

  it('keeps the look a render just committed until the status names a new one', async () => {
    serve({ captionKind: 'video', captionStyle: null, renderedCaptionStyle: null })
    const { client, panel } = setupSync('sync-2')
    await flush()
    act(() => panel.result.current.change({ accent: '#FFE500' }))
    await flush()
    store.set(commitRenderSettingsBaselineAtom, {
      projectId: 'sync-2',
      submitted: { captionEnabled: true, captionStyle: { accent: '#FFE500' } },
    })
    // The status read again still says what it said before the render.
    await act(() => client.invalidateQueries())
    await flush()
    expect(store.get(renderSettingsAtom).captionStyle.original).toEqual({
      accent: '#FFE500',
      position: null,
      preset: 'classic',
      size: 100,
    })
    expect(store.get(renderSettingsChangedAtom)).toBe(false)
  })

  it('asks a wide video rendered before saved looks for a render, and a tall one not', async () => {
    serve({ captionKind: 'video', captionStyle: null, renderedCaptionStyle: null })
    setupSync('sync-wide', '16 / 9')
    await flush()
    expect(store.get(renderSettingsAtom).captionStyle.aspectRatio).toBe('16:9')
    expect(store.get(renderSettingsChangedAtom)).toBe(true)

    setupSync('sync-tall', '9 / 16')
    await flush()
    expect(store.get(renderSettingsChangedAtom)).toBe(false)
  })

  it('seeds again after the render settings were reset for the project', async () => {
    serve({ captionKind: 'loop', captionStyle: null, renderedCaptionStyle: { preset: 'punch' } })
    setupSync('sync-3')
    await flush()
    store.set(renderSettingsAtom, (prev) => ({
      ...prev,
      captionStyle: {
        aspectRatio: '9:16',
        kind: 'video',
        known: false,
        latest: null,
        original: null,
      },
    }))
    await flush()
    expect(store.get(renderSettingsAtom).captionStyle).toEqual({
      aspectRatio: '9:16',
      kind: 'loop',
      known: true,
      latest: null,
      original: { preset: 'punch' },
    })
  })
})

describe('useDeliveredCaptionLookDiffers', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockFetchApiDomain.mockReset()
  })
  afterEach(() => jest.useRealTimers())

  function setupDiffers(projectId: string, captionsOn = true) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const differs = renderHook(
      () => useDeliveredCaptionLookDiffers(projectId, '9 / 16', captionsOn),
      { wrapper },
    )
    const panel = renderHook(() => useCaptionSettings(projectId), { wrapper })
    return { differs, panel }
  }

  it('says so for a loop delivered before looks were recorded: Download renders it in Punch', async () => {
    serve({ captionKind: 'loop', captionStyle: null, renderedCaptionStyle: null })
    const { differs } = setupDiffers('differs-1')
    // Nothing is said before the status is read.
    expect(differs.result.current).toBe(false)
    await flush()
    expect(differs.result.current).toBe(true)
  })

  it('says nothing while the file has the look on screen, and so once the user changes it', async () => {
    serve({
      captionKind: 'video',
      captionStyle: { preset: 'punch' },
      renderedCaptionStyle: { preset: 'punch' },
    })
    const { differs, panel } = setupDiffers('differs-2')
    await flush()
    expect(differs.result.current).toBe(false)
    act(() => panel.result.current.change({ accent: '#FFE500' }))
    await flush()
    expect(differs.result.current).toBe(true)
  })

  it("compares only a loop's stamp colour while captions are off", async () => {
    serve({
      captionKind: 'loop',
      captionStyle: { accent: '#FFE500', preset: 'explainer' },
      renderedCaptionStyle: { accent: '#FFE500', preset: 'punch' },
    })
    const { differs, panel } = setupDiffers('differs-3', false)
    await flush()
    expect(differs.result.current).toBe(false)
    act(() => panel.result.current.change({ accent: '#FF3EA5' }))
    await flush()
    expect(differs.result.current).toBe(true)
  })
})
