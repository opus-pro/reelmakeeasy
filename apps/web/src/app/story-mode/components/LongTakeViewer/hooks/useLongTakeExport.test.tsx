import type { LongTakeRenderRequest } from '@shared/types/api/long-take'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { getDefaultStore } from 'jotai'
import type { ReactNode } from 'react'

const mockStartExport = jest.fn(async () => undefined)
let mockRunnerOptions: { onRenderComplete?: (submitted: LongTakeRenderRequest) => void } = {}
jest.mock('./useLongTakeExportRunner', () => ({
  useLongTakeExportRunner: (options: typeof mockRunnerOptions) => {
    mockRunnerOptions = options
    return {
      isActive: false,
      isCompleted: false,
      isUpscaling: false,
      startExport: mockStartExport,
      status: 'idle',
    }
  },
}))
jest.mock('./useUnrenderedChanges', () => ({ useInvalidateUnrenderedChanges: () => jest.fn() }))
jest.mock('@shared/ui', () => ({ toast: { error: jest.fn(), warning: jest.fn() } }))

import {
  longtakeHistoryStore,
  type RenderSettings,
  renderSettingsAtom,
} from '@/atom/longtake-history.store'
import { captionStatusQueryKey } from '@/components/captions/useCaptionSettings'
import { videoScriptQueryKey } from '@/hooks/useVideoScript'

import { useLongTakeExport } from './useLongTakeExport'

const store = getDefaultStore()

function setCaptionStyle(captionStyle: Partial<RenderSettings['captionStyle']>) {
  store.set(renderSettingsAtom, (prev) => ({
    captionEnabled: { latest: true, original: true },
    captionStyle: { ...prev.captionStyle, ...captionStyle },
  }))
}

function setup() {
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useLongTakeExport({ projectId: 'p1' }), { wrapper })
  return { client, hook }
}

/** What the last export asked the runner for. */
function lastExport() {
  const calls = mockStartExport.mock.calls as unknown as [
    boolean,
    { renderRequired: boolean; request: LongTakeRenderRequest },
  ][]
  return calls.at(-1)?.[1]
}

describe('useLongTakeExport caption look', () => {
  beforeEach(() => {
    mockStartExport.mockClear()
    store.set(longtakeHistoryStore.seedRenderSettingsProjectAtom, `reset-${Math.random()}`)
    store.set(longtakeHistoryStore.editedProjectIdAtom, 'p1')
  })

  it('downloads the delivered file when the look is the one it was rendered with', async () => {
    const { hook } = setup()
    // Rendered before anybody chose a look, and the panel now names the same default.
    setCaptionStyle({
      kind: 'video',
      known: true,
      latest: { accent: '#04F827', preset: 'classic', size: 100 },
      original: null,
    })
    await act(() => hook.result.current.startExport(false))

    expect(lastExport()?.renderRequired).toBe(false)
    expect(lastExport()?.request.settings).toEqual({
      captionEnabled: true,
      captionStyle: { accent: '#04F827', preset: 'classic', size: 100 },
    })
  })

  it('renders again when the look differs, sending the look the user is looking at', async () => {
    const { hook } = setup()
    setCaptionStyle({
      kind: 'loop',
      known: true,
      latest: { accent: '#FF3EA5', preset: 'explainer' },
      original: { preset: 'punch' },
    })
    await act(() => hook.result.current.startExport(false))

    expect(lastExport()?.renderRequired).toBe(true)
    expect(lastExport()?.request.settings?.captionStyle).toEqual({
      accent: '#FF3EA5',
      preset: 'explainer',
    })
  })

  it('renders a wide video rendered before saved looks again: its captions now sit lower', async () => {
    const { hook } = setup()
    setCaptionStyle({
      aspectRatio: '16:9',
      kind: 'video',
      known: true,
      latest: null,
      original: null,
    })
    await act(() => hook.result.current.startExport(false))

    expect(lastExport()?.renderRequired).toBe(true)
    expect(lastExport()?.request.settings?.captionStyle).toBeNull()
  })

  it('downloads a wide video with captions off as it is: there are no captions to move', async () => {
    const { hook } = setup()
    setCaptionStyle({
      aspectRatio: '16:9',
      kind: 'video',
      known: true,
      latest: null,
      original: null,
    })
    store.set(renderSettingsAtom, (prev) => ({
      ...prev,
      captionEnabled: { latest: false, original: false },
    }))
    await act(() => hook.result.current.startExport(false))

    expect(lastExport()?.renderRequired).toBe(false)
  })

  it('renders a loop rendered before saved looks again, in Punch', async () => {
    const { hook } = setup()
    setCaptionStyle({
      aspectRatio: '9:16',
      kind: 'loop',
      known: true,
      latest: null,
      original: null,
    })
    await act(() => hook.result.current.startExport(false))

    expect(lastExport()?.renderRequired).toBe(true)
  })

  it("leaves the look to the server while the project's look is unknown", async () => {
    const { hook } = setup()
    setCaptionStyle({ known: false, latest: { preset: 'punch' }, original: null })
    await act(() => hook.result.current.startExport(false))

    expect(lastExport()?.renderRequired).toBe(false)
    expect(lastExport()?.request.settings).toEqual({ captionEnabled: true })
  })

  it('takes the rendered look as the new baseline and reads the status again', async () => {
    const { client } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    setCaptionStyle({ kind: 'video', known: true, latest: { size: 140 }, original: null })

    act(() =>
      mockRunnerOptions.onRenderComplete?.({
        expectedRevision: 'r1',
        keyframes: [],
        settings: { captionEnabled: true, captionStyle: { size: 140 } },
        transitions: [],
      }),
    )

    expect(store.get(renderSettingsAtom).captionStyle).toMatchObject({
      latest: { size: 140 },
      original: { size: 140 },
    })
    expect(store.get(longtakeHistoryStore.renderSettingsChangedAtom)).toBe(false)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: captionStatusQueryKey('p1') })
  })

  it('reads the video script again: the preview draws what the new render saved', () => {
    const { client } = setup()
    const invalidate = jest.spyOn(client, 'invalidateQueries')

    // An older loop's first render since stamps became a track saves its facts track.
    act(() =>
      mockRunnerOptions.onRenderComplete?.({
        expectedRevision: 'r1',
        keyframes: [],
        settings: { captionEnabled: false },
        transitions: [],
      }),
    )

    expect(invalidate).toHaveBeenCalledWith({ queryKey: videoScriptQueryKey('p1') })
  })

  it("records a render with nothing chosen as the kind's default look, so it isn't rendered again", () => {
    setup()
    setCaptionStyle({
      aspectRatio: '9:16',
      kind: 'loop',
      known: true,
      latest: null,
      original: null,
    })
    expect(store.get(longtakeHistoryStore.renderSettingsChangedAtom)).toBe(true)

    act(() =>
      mockRunnerOptions.onRenderComplete?.({
        expectedRevision: 'r1',
        keyframes: [],
        settings: { captionEnabled: true, captionStyle: null },
        transitions: [],
      }),
    )

    expect(store.get(renderSettingsAtom).captionStyle.original).toEqual({
      accent: '#04F827',
      position: null,
      preset: 'punch',
      size: 100,
    })
    expect(store.get(longtakeHistoryStore.renderSettingsChangedAtom)).toBe(false)
  })
})
