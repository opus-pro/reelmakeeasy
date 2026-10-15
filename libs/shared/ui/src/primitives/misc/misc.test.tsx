import { act, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'

import { Popover, Slider, ToastPill } from './index'

beforeAll(() => {
  // Radix's popper measures its trigger.
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    disconnect = jest.fn()
    observe = jest.fn()
    unobserve = jest.fn()
  }
  Element.prototype.scrollIntoView = jest.fn()
})

describe('Popover', () => {
  it('keeps wheel events inside the panel away from document listeners', async () => {
    const seen: string[] = []
    const onWheel = () => seen.push('document')
    document.addEventListener('wheel', onWheel)
    render(
      <Popover content={<div data-testid="panel">C</div>} open>
        <button type="button">t</button>
      </Popover>,
    )
    await act(() => Promise.resolve())
    fireEvent.wheel(screen.getByTestId('panel'))
    fireEvent.wheel(screen.getByRole('button'))
    document.removeEventListener('wheel', onWheel)
    expect(seen).toEqual(['document'])
  })
})

describe('Slider', () => {
  it('draws the buffer only when asked', () => {
    const { container, rerender } = render(<Slider bufferProgress={70} value={[50]} />)
    expect(container.querySelector('[style*="width: 70%"]')).toBeNull()
    rerender(<Slider bufferProgress={70} showBuffer value={[50]} />)
    expect(container.querySelector('[style*="width: 70%"]')).not.toBeNull()
  })
})

describe('ToastPill', () => {
  it('shows a close button only for toasts that never time out', () => {
    const { rerender } = render(<ToastPill duration={3000} id={1} message="M" variant="success" />)
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    rerender(<ToastPill duration={Infinity} id={1} message="M" variant="error" />)
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })

  it('runs the action with the click event', () => {
    const onClick = jest.fn()
    render(<ToastPill action={{ label: 'Go', onClick }} id={1} message="M" variant="error" />)
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ type: 'click' }))
  })
})
