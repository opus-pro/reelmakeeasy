import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import React from 'react'

const mockFetchApiDomain = jest.fn()
jest.mock('@/hooks/useApi', () => ({ useApi: () => ({ fetchApiDomain: mockFetchApiDomain }) }))

import { filterVoicesByEngine, TtsEngineToggle } from './tts-engines'
import { usePresetVoiceOptions } from './voice-over-selection'
import { VoiceItem } from './VoiceItem'

/** fal makes the videos and there is no Gemini key: Gemini is still listed. */
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

function queryWrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  mockFetchApiDomain.mockReset().mockResolvedValue({ data: ENGINES, ok: true })
})

describe('the Gemini voices in the library while fal makes the videos', () => {
  it('shows a Gemini chip with a plain Paid tag, between the free engines and ElevenLabs', async () => {
    const onChange = jest.fn()
    renderWithQuery(<TtsEngineToggle onChange={onChange} value="all" />)
    const gemini = await screen.findByRole('radio', { name: /Gemini/ })
    expect(gemini.textContent).toContain('Paid')
    expect(gemini.textContent).not.toContain('·')
    expect(gemini.getAttribute('title')).toBe('Gemini voices are billed to your Gemini API key.')
    expect(screen.getAllByRole('radio').map((chip) => chip.textContent)).toEqual([
      'All',
      expect.stringContaining('Kokoro'),
      expect.stringContaining('Qwen'),
      expect.stringContaining('Gemini'),
      expect.stringContaining('ElevenLabs'),
    ])
    fireEvent.click(gemini)
    expect(onChange).toHaveBeenCalledWith('gemini')
  })

  it('filters the list to the Gemini voices', () => {
    const voices = [
      { name: 'Gemini Kore', provider: 'gemini', value: 'gemini-kore' },
      { name: 'Heart', provider: 'kokoro', value: 'kokoro-af_heart' },
      { name: 'Gemini Puck', provider: 'gemini', value: 'gemini-puck' },
    ]
    expect(filterVoicesByEngine(voices, 'gemini').map((v) => v.value)).toEqual([
      'gemini-kore',
      'gemini-puck',
    ])
  })

  it('greys out a Gemini voice without the key: it plays its preview but is not picked', () => {
    const onPlayback = jest.fn()
    const onSelect = jest.fn()
    const voice = {
      name: 'Gemini Kore',
      needsPresignedUrl: true,
      provider: 'gemini',
      value: 'gemini-kore',
    }
    render(
      <VoiceItem
        onPlayback={onPlayback}
        onSelect={onSelect}
        previewWhenUnavailable
        unavailableHref="/setup"
        unavailableReason="Needs a Gemini key: add it in Setup"
        voice={voice}
      />,
    )
    const play = screen.getByRole('button', { name: 'Play voice preview' })
    expect(play.hasAttribute('disabled')).toBe(false)
    fireEvent.click(play)
    expect(onPlayback).toHaveBeenCalledWith(voice)

    fireEvent.click(screen.getByText('Gemini Kore'))
    expect(onSelect).not.toHaveBeenCalled()

    const links = screen.getAllByRole('link', { name: 'Needs a Gemini key: add it in Setup' })
    expect(links[0]?.getAttribute('href')).toBe('/setup')
    // Setup opens in a new tab: this page (an unsent chat or brief, the open voice library)
    // stays as it is.
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    }
    fireEvent.click(links[0] as HTMLElement)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('keeps a greyed-out voice clone silent, as before', () => {
    const onPlayback = jest.fn()
    render(
      <VoiceItem
        onPlayback={onPlayback}
        unavailableReason="Needs an ElevenLabs key"
        voice={{ name: 'My clone', provider: 'elevenlabs', value: 'c1', voiceCloneId: 'c1' }}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Play voice preview' }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it("keeps the API's reason on each keyless Gemini row, so it is greyed out as soon as the list shows", async () => {
    mockFetchApiDomain.mockReset().mockResolvedValue({
      data: {
        data: [
          {
            description: '',
            id: 'gemini-kore',
            labels: ['American'],
            name: 'Gemini Kore',
            needsPresignedUrl: true,
            previewAudioUrl: '',
            provider: 'gemini',
            tone: 'Firm',
            unavailableReason: 'Needs a Gemini key: add it in Setup',
            voiceId: 'gemini-kore',
          },
          {
            description: '',
            id: 'kokoro-af_heart',
            labels: ['American'],
            name: 'Heart',
            previewAudioUrl: '',
            provider: 'kokoro',
            tone: 'Warm',
            voiceId: 'kokoro-af_heart',
          },
        ],
      },
      ok: true,
    })
    const { result } = renderHook(() => usePresetVoiceOptions(), { wrapper: queryWrapper })
    await waitFor(() => expect(result.current.options).toHaveLength(2))
    expect(result.current.options.map((o) => o.unavailableReason)).toEqual([
      'Needs a Gemini key: add it in Setup',
      undefined,
    ])
  })
})
