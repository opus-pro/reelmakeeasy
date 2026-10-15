import type { SetupStatus } from '@shared/types/api/setup'
import { render, screen } from '@testing-library/react'

let mockStatus: null | SetupStatus = null
jest.mock('./useSetupStatus', () => ({
  useSetupStatus: () => ({
    error: null,
    loading: false,
    recheck: jest.fn(),
    save: jest.fn(),
    saving: false,
    status: mockStatus,
  }),
}))
jest.mock('./SetupCard', () => ({
  SetupCard: () => jest.requireActual('react').createElement('div', null, 'Get set up'),
}))
jest.mock('@shared/ui', () => ({ toast: { success: jest.fn() } }))
const mockPrompt = jest.fn((_props: Record<string, unknown>) => null)
jest.mock('./FirstVideoPrompt', () => ({
  FirstVideoPrompt: (props: Record<string, unknown>) => mockPrompt(props),
}))

import { missing, ready, setupStatus } from './setup-status.fixtures'
import { HomeSetupCard, SetupPagePanel } from './SetupEntry'

describe('HomeSetupCard', () => {
  it('stays away while loading, and once everything has an answer', () => {
    mockStatus = null
    const { container, rerender } = render(<HomeSetupCard />)
    expect(container.textContent).toBe('')
    mockStatus = setupStatus({ claude: ready, fal: true })
    rerender(<HomeSetupCard />)
    expect(container.textContent).toBe('')
  })

  it('shows while nothing can write the videos', () => {
    mockStatus = setupStatus({ claude: missing, fal: true })
    render(<HomeSetupCard />)
    expect(screen.getByText('Get set up')).toBeTruthy()
  })

  it('tells the first-video prompt whether the card is showing, so it waits for Save', () => {
    const onBusyChange = jest.fn()
    const onTryExample = jest.fn()
    mockStatus = setupStatus({ claude: missing, fal: true })
    const { rerender } = render(
      <HomeSetupCard onBusyChange={onBusyChange} onTryExample={onTryExample} />,
    )
    expect(mockPrompt).toHaveBeenLastCalledWith(
      expect.objectContaining({ cardShowing: true, onBusyChange, onTryExample }),
    )
    // Saved: the status read after Save has everything in effect, so the card goes away.
    mockStatus = setupStatus({ claude: ready, fal: true })
    rerender(<HomeSetupCard onBusyChange={onBusyChange} onTryExample={onTryExample} />)
    expect(screen.queryByText('Get set up')).toBeNull()
    expect(mockPrompt).toHaveBeenLastCalledWith(
      expect.objectContaining({ cardShowing: false, checking: false, status: mockStatus }),
    )
  })
})

describe('SetupPagePanel', () => {
  it('always shows the card', () => {
    mockStatus = setupStatus({ claude: ready, fal: true })
    render(<SetupPagePanel />)
    expect(screen.getByText('Get set up')).toBeTruthy()
  })
})
