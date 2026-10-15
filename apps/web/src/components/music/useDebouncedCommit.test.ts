import { act, renderHook } from '@testing-library/react'

import { useDebouncedCommit } from './useDebouncedCommit'

describe('useDebouncedCommit', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('commits only the last value once the presses stop', () => {
    const onCommit = jest.fn()
    const { result } = renderHook(() => useDebouncedCommit(onCommit, 500))
    act(() => {
      result.current(89)
      jest.advanceTimersByTime(200)
      result.current(88)
      jest.advanceTimersByTime(200)
      result.current(87)
    })
    expect(onCommit).not.toHaveBeenCalled()
    act(() => {
      jest.advanceTimersByTime(500)
    })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(87)
  })

  it('commits a pending value when the control goes away', () => {
    const onCommit = jest.fn()
    const { result, unmount } = renderHook(() => useDebouncedCommit(onCommit, 500))
    act(() => result.current(60))
    unmount()
    expect(onCommit).toHaveBeenCalledWith(60)
  })
})
