import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { AvatarCreator } from './AvatarCreator'

const mockFetch = jest.fn()
const mockUpload = jest.fn()

jest.mock('jotai', () => ({ ...jest.requireActual('jotai'), useAtomValue: () => '' }))
jest.mock('@/hooks/useApi', () => ({ useApi: () => ({ fetchApiDomain: mockFetch }) }))
jest.mock('@/hooks/useAudio', () => ({ useAudio: () => ({ playingId: null, toggle: jest.fn() }) }))
jest.mock('../attachments/attachments', () => ({
  ...jest.requireActual('../attachments/attachments'),
  uploadAttachment: (...args: unknown[]) => mockUpload(...args),
}))
jest.mock('@/components/voice', () => ({
  usePresetVoiceOptions: () => ({ options: [] }),
  // The voice library: "Use Eric" picks a voice and confirms it.
  VoiceSelectionDialog: ({ onVoiceConfirm }: { onVoiceConfirm: (v: object) => void }) => (
    <button
      onClick={() => onVoiceConfirm({ name: 'Kokoro Eric', value: 'kokoro-am_eric' })}
      type="button"
    >
      Use Eric
    </button>
  ),
}))
jest.mock('../useAgentSession', () => ({
  useAgentSession: () => ({ transcript: { entries: [] } }),
}))
jest.mock('../AgentChat', () => ({ AgentChat: () => <p>Claude is drawing it</p> }))

describe('AvatarCreator', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockUpload.mockReset()
    global.URL.createObjectURL = jest.fn(() => 'blob:photo')
    global.URL.revokeObjectURL = jest.fn()
  })

  const renderCreator = (styles: ('2d' | '3d' | 'pixel')[] = ['pixel', '2d', '3d']) =>
    render(<AvatarCreator onClose={jest.fn()} onCreated={jest.fn()} open styles={styles} />)

  it('makes an avatar from a description alone, with its style, detail and voice', async () => {
    mockFetch.mockImplementation(async (url: string) =>
      url === '/api/agent/sessions' ? { data: { id: 's9' }, ok: true } : { ok: true },
    )
    renderCreator()
    const generate = screen.getByRole('button', { name: 'Generate avatar' }) as HTMLButtonElement
    expect(generate.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Pip ' } })
    expect(screen.getByText('Add a photo, or describe how it looks.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Describe how it looks'), {
      target: { value: 'a tiny robot with a big smile' },
    })
    // Pixel art first: the video's style takes any avatar.
    expect(screen.getByRole('radio', { name: 'Pixel art' }).getAttribute('aria-checked')).toBe(
      'true',
    )
    fireEvent.click(screen.getByRole('radio', { name: '3D' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pick a voice' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use Eric' }))
    expect(screen.getByText('Kokoro Eric')).toBeTruthy()
    fireEvent.click(generate)
    await screen.findByText('Claude is drawing it')
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/agent/sessions',
      expect.objectContaining({
        data: { harness: 'claude', mode: 'animation', title: 'Avatar: Pip' },
      }),
    )
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/agent/sessions/{id}/animation',
      expect.objectContaining({
        data: {
          avatar: { description: 'a tiny robot with a big smile', name: 'Pip', style: '3d' },
          avatarOnly: true,
          avatarVoiceId: 'kokoro-am_eric',
          detail: 'xhigh',
          lengthSec: 15,
          lookId: 'avatar',
          music: { source: 'none' },
          subject: null,
        },
        pathParams: { id: 's9' },
      }),
    )
  })

  it("uploads the photo to the creator's own chat, and keeps the video's one style", async () => {
    mockFetch.mockResolvedValue({ data: { id: 's7' }, ok: true })
    mockUpload.mockResolvedValue({ name: 'me.jpg' })
    renderCreator(['2d'])
    expect(screen.getByText(/2D, like the video's style/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Photo for the avatar'), {
      target: { files: [new File(['abc'], 'me.jpg', { type: 'image/jpeg' })] },
    })
    await waitFor(() => expect(mockUpload).toHaveBeenCalled())
    expect(mockUpload.mock.calls[0]?.[1]).toBe('s7')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Sam' } })
    expect(
      (screen.getByRole('button', { name: 'Generate avatar' }) as HTMLButtonElement).disabled,
    ).toBe(false)
    expect(screen.getByLabelText('Describe it (optional)')).toBeTruthy()
  })
})
