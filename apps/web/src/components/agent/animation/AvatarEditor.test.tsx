import type { AgentAvatar } from '@shared/types/api/agent'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { AvatarEditor } from './AvatarEditor'

const mockFetch = jest.fn()

jest.mock('@/hooks/useApi', () => ({ useApi: () => ({ fetchApiDomain: mockFetch }) }))
jest.mock('./AvatarVoice', () => ({ AvatarVoice: () => <p>Its voice row</p> }))
jest.mock('../useAgentSession', () => ({
  useAgentSession: () => ({ transcript: { entries: [] } }),
}))
jest.mock('../AgentChat', () => ({ AgentChat: () => <p>Claude is changing it</p> }))

const max: AgentAvatar = {
  createdAt: '2026-10-27T00:00:00Z',
  id: 'av-00000000c1',
  look: '',
  name: 'Max',
  previewUrl: '/p.png',
  style: '2d',
  updatedAt: '2026-10-28T00:00:00Z',
  voiceDescription: '',
  voiceId: 'kokoro-af_bella',
  voiceSampleUrl: null,
}

describe('AvatarEditor', () => {
  beforeEach(() => mockFetch.mockReset())

  it('changes a saved avatar in a chat of its own, and hands it back as saved', async () => {
    mockFetch.mockImplementation(async (url: string) =>
      url === '/api/agent/sessions'
        ? { data: { id: 's3' }, ok: true }
        : url === '/api/agent/avatars'
          ? { data: [{ ...max, updatedAt: '2026-10-30T00:00:00Z' }], ok: true }
          : { ok: true },
    )
    const onClose = jest.fn()
    render(<AvatarEditor avatar={max} onClose={onClose} />)
    expect(screen.getByText('Edit Max')).toBeTruthy()
    expect(screen.getByText('Its voice row')).toBeTruthy()
    const update = screen.getByRole('button', { name: 'Update avatar' }) as HTMLButtonElement
    expect(update.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Change how it looks'), {
      target: { value: ' shorter hair ' },
    })
    fireEvent.click(update)
    await screen.findByText('Claude is changing it')
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/agent/sessions',
      expect.objectContaining({
        data: { harness: 'claude', mode: 'animation', title: 'Edit avatar: Max' },
      }),
    )
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/agent/sessions/{id}/animation',
      expect.objectContaining({
        data: {
          avatar: { id: 'av-00000000c1' },
          avatarChange: 'shorter hair',
          avatarOnly: true,
          lengthSec: 15,
          lookId: 'avatar',
          music: { source: 'none' },
          subject: null,
        },
        pathParams: { id: 's3' },
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() =>
      expect(onClose).toHaveBeenCalledWith({ ...max, updatedAt: '2026-10-30T00:00:00Z' }),
    )
  })
})
