import { render, screen } from '@testing-library/react'

import { ChatModelBar } from './ChatModelBar'

jest.mock('./useChatModel', () => ({
  useChatModel: (_id: string, enabled: boolean) => ({
    busy: false,
    error: null,
    pick: jest.fn(),
    refresh: jest.fn(),
    setDefault: jest.fn(),
    state: enabled
      ? {
          current: { effort: 'medium', model: 'gpt-6-astra' },
          default: null,
          harness: 'codex',
          models: [{ efforts: ['medium'], id: 'gpt-6-astra', label: 'GPT-6-Astra' }],
          recommended: null,
          source: 'recommended',
        }
      : null,
  }),
}))

const session = {
  id: 's1',
  mode: undefined,
  projectId: null,
  status: 'idle',
  threadId: null,
  title: 'New chat',
}

describe('ChatModelBar', () => {
  it('shows under every chat: before a mode is chosen, in Easy and in free chat', () => {
    for (const mode of [undefined, 'autonomous', 'free']) {
      const { unmount } = render(<ChatModelBar session={{ ...session, mode } as never} />)
      expect(screen.getByRole('button', { name: 'Model: GPT-6-Astra · Medium' })).toBeTruthy()
      unmount()
    }
  })

  it('shows nothing while there is no chat', () => {
    const { container } = render(<ChatModelBar session={null} />)
    expect(container.textContent).toBe('')
  })
})
