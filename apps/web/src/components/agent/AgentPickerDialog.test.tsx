import { act, fireEvent, render, screen } from '@testing-library/react'

const mockFetchApiDomain = jest.fn()
jest.mock('@/hooks/useApi', () => ({ useApi: () => ({ fetchApiDomain: mockFetchApiDomain }) }))
const mockPush = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))
jest.mock('@/util/hard-navigation', () => ({ hardNavigate: jest.fn() }))

import { useAgentPicker } from './AgentPickerDialog'

const READY = { available: true, binary: '/bin/agent', loggedIn: true, version: '1' }
const STATUS = { ...READY, claude: READY, codex: READY, defaultHarness: 'codex' }

/** A "New chat" button with its Agent dialog, as the sidebar has it. */
function NewChat() {
  const { openPicker, picker, starting } = useAgentPicker({ hard: false })
  return (
    <>
      <button disabled={starting} onClick={openPicker} type="button">
        {starting ? 'Opening…' : 'New chat'}
      </button>
      {picker}
    </>
  )
}

let created = (_session: { data: { id: string } }): void => undefined

beforeEach(() => {
  mockFetchApiDomain.mockReset()
  mockPush.mockReset()
  mockFetchApiDomain.mockImplementation((url: string) =>
    url.startsWith('/api/agent/status')
      ? Promise.resolve({ data: STATUS })
      : new Promise((resolve) => {
          created = resolve
        }),
  )
})

const sessionPosts = () =>
  mockFetchApiDomain.mock.calls.filter(([url]) => url === '/api/agent/sessions')

describe('the Agent dialog', () => {
  it('closes on a pick, and a second click on the agent makes no second chat', async () => {
    render(<NewChat />)
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    const codex = await screen.findByRole('radio', { name: /Codex.*Ready/ })

    await act(async () => {
      fireEvent.click(codex)
      fireEvent.click(codex)
    })

    expect(screen.queryByText('Choose your agent')).toBeNull()
    expect(sessionPosts()).toHaveLength(1)
    expect(sessionPosts()[0][1]).toEqual({ data: { harness: 'codex' }, method: 'POST' })
    // The button says the chat is opening, and can't open the dialog again meanwhile.
    expect((screen.getByRole('button', { name: 'Opening…' }) as HTMLButtonElement).disabled).toBe(
      true,
    )

    await act(async () => {
      created({ data: { id: 's1' } })
    })
    expect(mockPush).toHaveBeenCalledTimes(1)
    expect(mockPush).toHaveBeenCalledWith('/agent?sessionId=s1')
    expect(sessionPosts()).toHaveLength(1)
  })

  it('closing it starts nothing', async () => {
    render(<NewChat />)
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    await screen.findByRole('radio', { name: /Codex.*Ready/ })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('Choose your agent')).toBeNull()
    expect(sessionPosts()).toHaveLength(0)
  })
})
