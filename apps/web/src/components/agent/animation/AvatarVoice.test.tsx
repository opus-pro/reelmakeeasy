import type { AgentAvatar } from '@shared/types/api/agent'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { AvatarVoice } from './AvatarVoice'

const mockFetch = jest.fn()
const mockToggle = jest.fn()

jest.mock('@/hooks/useApi', () => ({ useApi: () => ({ fetchApiDomain: mockFetch }) }))
jest.mock('@/hooks/useAudio', () => ({
  useAudio: () => ({ playingId: null, toggle: mockToggle }),
}))
jest.mock('@/components/voice', () => ({
  usePresetVoiceOptions: () => ({
    options: [
      {
        name: 'Kokoro Michael',
        previewAudioUrl: '/michael.mp3',
        tone: 'Deep',
        value: 'kokoro-am_michael',
      },
      { name: 'Qwen Ryan', previewAudioUrl: '/ryan.mp3', tone: 'Dynamic', value: 'qwen3-ryan' },
    ],
  }),
  useUserVoiceClones: () => ({ userVoices: [] }),
  useVoicePreviewUrl: () => ({ data: null }),
  // The voice library: "Use Ryan" picks a voice and confirms it.
  VoiceSelectionDialog: ({
    onVoiceConfirm,
  }: {
    onVoiceConfirm: (voice: { name: string; value: string }) => void
  }) => (
    <button
      onClick={() => onVoiceConfirm({ name: 'Qwen Ryan', value: 'qwen3-ryan' })}
      type="button"
    >
      Use Ryan
    </button>
  ),
}))

const ALLEN: AgentAvatar = {
  createdAt: '2026-10-27T00:00:00Z',
  id: 'av-0123456789',
  name: 'Allen',
  previewUrl: null,
  style: '2d',
  voiceDescription: 'a calm, clear young man',
  voiceId: 'kokoro-am_michael',
  voiceSampleUrl: null,
}

describe('AvatarVoice', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockToggle.mockReset()
  })

  it('shows the fixed voice, plays it, and saves a new one to the avatar', async () => {
    const onChange = jest.fn()
    mockFetch.mockResolvedValue({ data: { ...ALLEN, voiceId: 'qwen3-ryan' }, ok: true })
    render(<AvatarVoice avatar={ALLEN} onChange={onChange} />)
    expect(screen.getByText('Kokoro Michael')).toBeTruthy()
    expect(screen.getByText('Allen speaks in this voice in every video.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Play the voice' }))
    expect(mockToggle).toHaveBeenCalledWith(
      expect.stringContaining('av-0123456789'),
      '/michael.mp3',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Change voice' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use Ryan' }))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(mockFetch).toHaveBeenCalledWith('/api/agent/avatars/av-0123456789/voice', {
      data: { voiceId: 'qwen3-ryan' },
      method: 'PUT',
      noThrowError: true,
    })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ voiceId: 'qwen3-ryan' }))
  })

  it('says a voice made from the description can drift, and offers a fixed one', () => {
    render(
      <AvatarVoice
        avatar={{ ...ALLEN, voiceId: null, voiceSampleUrl: '/sample.wav' }}
        onChange={jest.fn()}
      />,
    )
    expect(screen.getByText('Made from its description')).toBeTruthy()
    expect(screen.getByText(/can sound a little different each time/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pick a voice' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Play the voice' }))
    expect(mockToggle).toHaveBeenCalledWith(expect.any(String), '/sample.wav')
  })
})
