import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import React from 'react'

import type { ResourceMenuAction } from '@/components/shared/ResourceOptionsMenu'

import type { VoiceOption } from './voice-over-selection'

/** fal makes the videos; no Gemini key, no ElevenLabs key. */
const ENGINES = {
  elevenlabsKey: false,
  engines: {
    elevenlabs: { free: false, runsOn: 'fal' },
    gemini: { free: false, runsOn: 'google' },
    kokoro: { free: true, runsOn: 'local' },
    qwen3: { free: false, runsOn: 'fal' },
  },
  geminiKey: false,
  generationProvider: 'fal',
  qwen3Clone: { available: true },
  shown: ['gemini', 'kokoro', 'qwen3', 'elevenlabs'],
  standardClone: 'minimax',
}

const mockFetchApiDomain = jest.fn()
jest.mock('@/hooks/useApi', () => ({ useApi: () => ({ fetchApiDomain: mockFetchApiDomain }) }))

// Each row's menu, as the list hands it to the row.
const mockMenus = new Map<string, null | ResourceMenuAction[] | undefined>()
jest.mock('./VoiceItem', () => ({
  VoiceItem: ({
    menuActions,
    voice,
  }: {
    menuActions?: null | ResourceMenuAction[]
    voice: VoiceOption
  }) => {
    mockMenus.set(voice.value, menuActions)
    return null
  },
}))

import { VoiceList } from './VoiceList'

const KOKORO: VoiceOption = { name: 'Heart', provider: 'kokoro', value: 'kokoro-af_heart' }
const GEMINI: VoiceOption = {
  name: 'Gemini Kore',
  needsPresignedUrl: true,
  provider: 'gemini',
  value: 'gemini-kore',
}
const ELEVENLABS_CLONE: VoiceOption = {
  name: 'My clone',
  provider: 'elevenlabs',
  value: 'clone-1',
  voiceCloneId: 'clone-1',
}

function renderList(voices: VoiceOption[], defaultVoiceId: null | string = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <VoiceList defaultVoiceId={defaultVoiceId} selected={null} voices={voices} />
    </QueryClientProvider>,
  )
}

const actionIds = (value: string) => (mockMenus.get(value) ?? []).map((action) => action.id)

beforeEach(() => {
  mockMenus.clear()
  mockFetchApiDomain.mockReset().mockResolvedValue({ data: ENGINES, ok: true })
})

describe('VoiceList: the voice menu', () => {
  it('offers "Set as default" only on a voice that can be used', async () => {
    renderList([KOKORO, GEMINI, ELEVENLABS_CLONE])
    // The keys report arrives: the ElevenLabs clone can't speak without its key.
    await waitFor(() => expect(mockFetchApiDomain).toHaveBeenCalled())
    await waitFor(() => expect(actionIds(ELEVENLABS_CLONE.value)).toEqual(['rename', 'delete']))
    expect(actionIds(KOKORO.value)).toEqual(['set-default'])
    // A Gemini voice without the key has nothing to offer: no menu at all.
    expect(mockMenus.get(GEMINI.value)).toBeNull()
  })

  it('still lets an unusable default be cleared', async () => {
    renderList([GEMINI, KOKORO], GEMINI.value)
    await waitFor(() => expect(mockFetchApiDomain).toHaveBeenCalled())
    expect(actionIds(GEMINI.value)).toEqual(['clear-default'])
  })

  it('drops the menu of a voice with any unavailable reason, not only a Gemini one', async () => {
    renderList([{ ...KOKORO, unavailableReason: 'Needs the free local voices' }])
    await waitFor(() => expect(mockFetchApiDomain).toHaveBeenCalled())
    expect(mockMenus.get(KOKORO.value)).toBeNull()
  })
})
