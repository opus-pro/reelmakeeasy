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

  it('makes an avatar from a description alone, drawn as it says, with its detail and voice', async () => {
    mockFetch.mockImplementation(async (url: string) =>
      url === '/api/agent/sessions' ? { data: { id: 's9' }, ok: true } : { ok: true },
    )
    renderCreator()
    const generate = screen.getByRole('button', { name: 'Generate avatar' }) as HTMLButtonElement
    expect(generate.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Pip ' } })
    expect(screen.getByText('Add a photo, or describe how it looks.')).toBeTruthy()
    // No style to pick: it is drawn as the description says, else 2D.
    expect(screen.queryByRole('radio', { name: 'Pixel art' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Describe how it looks'), {
      target: { value: 'a tiny robot with a big smile' },
    })
    expect(screen.getByText(/Drawn in 2D: say 3D or pixel art/)).toBeTruthy()
    // An idea fills the description.
    fireEvent.click(screen.getByRole('button', { name: '3D robot' }))
    expect(screen.getByText(/Drawn in 3D\./)).toBeTruthy()
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
          avatar: {
            description:
              'A friendly 3D robot with a round head, big glowing blue eyes and a little antenna',
            name: 'Pip',
            style: '3d',
          },
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

  it("uploads the photo to the creator's own chat", async () => {
    mockFetch.mockResolvedValue({ data: { id: 's7' }, ok: true })
    mockUpload.mockResolvedValue({ name: 'me.jpg' })
    renderCreator(['2d'])
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

  it('makes one up for Surprise me: 2D or 3D, male or female', async () => {
    mockFetch.mockImplementation(async (url: string) =>
      url === '/api/agent/sessions' ? { data: { id: 's5' }, ok: true } : { ok: true },
    )
    renderCreator(['3d', '2d', 'pixel'])
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Surprise me' }))
    // 2D is recommended; a 3D video starts on 3D.
    expect(
      screen
        .getAllByRole('radio')
        .filter((r) => ['2D', '3D'].includes(r.getAttribute('aria-label') ?? ''))
        .map((r) => [r.textContent, r.getAttribute('aria-checked')]),
    ).toEqual([
      ['2DRecommended', 'false'],
      ['3D', 'true'],
    ])
    const generate = screen.getByRole('button', { name: 'Generate avatar' }) as HTMLButtonElement
    expect(generate.disabled).toBe(true)
    expect(screen.getByText('Pick male or female.')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Female' }))
    fireEvent.click(generate)
    await screen.findByText('Claude is drawing it')
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/agent/sessions/{id}/animation',
      expect.objectContaining({
        data: expect.objectContaining({
          avatar: { gender: 'female', name: 'Ada', style: '3d' },
          avatarOnly: true,
        }),
      }),
    )
  })
})
