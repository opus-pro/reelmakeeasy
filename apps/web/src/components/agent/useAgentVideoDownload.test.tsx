import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { getDefaultStore } from 'jotai'
import type { ReactNode } from 'react'

import type { RenderSettings } from '@/atom/longtake-history.store'

const mockFetchApiDomain = jest.fn()
// What the editor's settings said when the export started.
const mockStartExport = jest.fn<Promise<void>, [boolean, { forceRender: boolean }]>()
let exported: null | { changed: boolean; settings: RenderSettings } = null

jest.mock('@/hooks/useApi', () => ({ useApi: () => ({ fetchApiDomain: mockFetchApiDomain }) }))
jest.mock('@shared/ui', () => ({ toast: { error: jest.fn(), warning: jest.fn() } }))
jest.mock('@/app/story-mode/components/LongTakeViewer/LongTakeDownload', () => ({
  useLongTakeDownload: () => ({ isActive: false, startExport: mockStartExport }),
}))
jest.mock('./renderedFile', () => ({ renderedFileExists: async () => true }))
jest.mock('./useAgentProject', () => ({ useAgentProject: () => ({ longTakeRatio: '16:9' }) }))

import { renderSettingsAtom, renderSettingsChangedAtom } from '@/atom/longtake-history.store'
import type { CaptionStatus } from '@/components/captions/caption-settings.api'
import { captionStatusQueryKey } from '@/components/captions/useCaptionSettings'

import { useAgentVideoDownload } from './useAgentVideoDownload'
import type { ProjectProgress } from './useProjectProgress'

const store = getDefaultStore()

const progress = {
  bgmEnabled: false,
  captionsInVideo: true,
  noteRendered: jest.fn(),
  videoUrl: 'http://localhost:5017/api/files/p1/final.mp4',
} as unknown as ProjectProgress

/** Answers the editor state, the status (with `status` as its caption fields) and no draft. */
function serve(status: Record<string, unknown>) {
  mockFetchApiDomain.mockImplementation(async (path: string) => {
    if (path.endsWith('/state')) {
      return {
        data: { data: { keyframes: [], transitions: [] }, hasUnrenderedChanges: false },
        ok: true,
      }
    }
    if (path === '/api/long-take-videos/p1') return { data: { data: status }, ok: true }
    return { data: null, ok: false }
  })
}

function setup(cached?: CaptionStatus) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (cached) client.setQueryData(captionStatusQueryKey('p1'), cached)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useAgentVideoDownload({ progress, projectId: 'p1' }), { wrapper })
  return { client, hook }
}

describe('useAgentVideoDownload caption look', () => {
  beforeEach(() => {
    mockFetchApiDomain.mockReset()
    mockStartExport.mockReset()
    mockStartExport.mockImplementation(async () => {
      exported = {
        changed: store.get(renderSettingsChangedAtom),
        settings: store.get(renderSettingsAtom),
      }
    })
    exported = null
  })

  it('renders a wide video rendered before saved looks again: its captions now sit lower', async () => {
    serve({ captionKind: 'video', captionStyle: null, renderedCaptionStyle: null })
    const { hook } = setup()
    await act(() => hook.result.current.handleDownload())

    expect(exported?.settings.captionStyle).toEqual({
      aspectRatio: '16:9',
      kind: 'video',
      known: true,
      latest: null,
      original: null,
    })
    expect(exported?.changed).toBe(true)
  })

  it('downloads the look the previews draw, even when the status read is older than its save', async () => {
    // The status answers with the look saved before the last save landed.
    serve({
      captionKind: 'loop',
      captionStyle: { preset: 'punch' },
      renderedCaptionStyle: { preset: 'explainer' },
    })
    const { client, hook } = setup({
      accentSuggestion: null,
      kind: 'loop',
      rendered: { preset: 'punch' },
      saved: { preset: 'explainer' },
    })
    await act(() => hook.result.current.handleDownload())

    expect(exported?.settings.captionStyle).toMatchObject({
      latest: { preset: 'explainer' },
      original: { preset: 'explainer' },
    })
    expect(exported?.changed).toBe(false)
    // The read for the Download leaves the previews' look alone.
    expect(client.getQueryData<CaptionStatus>(captionStatusQueryKey('p1'))?.saved).toEqual({
      preset: 'explainer',
    })
  })
})
