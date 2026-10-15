import { act, renderHook } from '@testing-library/react'

import type { EngineActions } from '@/app/projects/[projectId]/editor/render-engine-sdk/render-engine.store'

import { useEnginePlayback } from './useEnginePlayback'

const engine = (): jest.Mocked<EngineActions> => ({
  playOrPause: jest.fn(),
  refresh: jest.fn(),
  seek: jest.fn(),
})

type Props = { loop?: boolean; playbackCompleted: boolean }

function playback(actions: EngineActions, initial: Props) {
  return renderHook(
    ({ loop, playbackCompleted }: Props) =>
      useEnginePlayback({ engineActions: actions, loop, playbackCompleted }),
    { initialProps: initial },
  )
}

describe('useEnginePlayback', () => {
  it('plays once: the end of playback pauses, and play starts again from the top', () => {
    const actions = engine()
    const { rerender, result } = playback(actions, { playbackCompleted: false })
    act(() => result.current.play())
    expect(actions.playOrPause).toHaveBeenLastCalledWith(true, false)

    rerender({ playbackCompleted: true })
    expect(result.current.isPlaying).toBe(false)
    expect(actions.seek).not.toHaveBeenCalled()

    act(() => result.current.play())
    expect(actions.seek).toHaveBeenCalledWith(0)
  })

  it('plays on a loop: asks the engine to loop, and goes on from the top if it reports the end', () => {
    const actions = engine()
    const { rerender, result } = playback(actions, { loop: true, playbackCompleted: false })
    act(() => result.current.play())
    expect(actions.playOrPause).toHaveBeenLastCalledWith(true, true)

    // An engine that stops at the end anyway: the loop starts over, still playing.
    rerender({ loop: true, playbackCompleted: true })
    expect(actions.seek).toHaveBeenCalledWith(0)
    expect(actions.playOrPause).toHaveBeenLastCalledWith(true, true)
    expect(result.current.isPlaying).toBe(true)
  })

  it("doesn't start a paused loop again when it reports the end", () => {
    const actions = engine()
    const { rerender, result } = playback(actions, { loop: true, playbackCompleted: false })
    rerender({ loop: true, playbackCompleted: true })
    expect(actions.seek).not.toHaveBeenCalled()
    expect(result.current.isPlaying).toBe(false)
  })
})
