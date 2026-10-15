import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'

import { videoScriptQueryKey } from '@/hooks/useVideoScript'

import { useReadVideoScriptOnDelivery } from './useReadVideoScriptOnDelivery'

function setup(initial: { delivered: boolean | undefined; projectId?: string }) {
  const client = new QueryClient()
  const invalidate = jest.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(
    ({ delivered, projectId }: { delivered: boolean | undefined; projectId: string }) =>
      useReadVideoScriptOnDelivery(projectId, delivered),
    { initialProps: { projectId: 'p1', ...initial }, wrapper },
  )
  return { hook, invalidate }
}

describe('useReadVideoScriptOnDelivery', () => {
  it('reads the video script again when the video it was generating is delivered', () => {
    // The panel shows while the loop renders: its read then found no video script yet.
    const { hook, invalidate } = setup({ delivered: false })
    expect(invalidate).not.toHaveBeenCalled()

    hook.rerender({ delivered: true, projectId: 'p1' })
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: videoScriptQueryKey('p1') })

    // Once: the same delivery seen again reads nothing.
    hook.rerender({ delivered: true, projectId: 'p1' })
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it('reads nothing twice when a delivered video is opened', () => {
    // The stage is unknown until the status is read, then the video is there.
    const { hook, invalidate } = setup({ delivered: undefined })
    hook.rerender({ delivered: true, projectId: 'p1' })
    expect(invalidate).not.toHaveBeenCalled()
  })

  it("reads nothing when another project's video is the one delivered", () => {
    const { hook, invalidate } = setup({ delivered: false })
    hook.rerender({ delivered: true, projectId: 'p2' })
    expect(invalidate).not.toHaveBeenCalled()
  })
})
