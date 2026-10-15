import { render } from '@testing-library/react'
import { useRef } from 'react'

import { useAutoGrow } from './useAutoGrow'

function Box({ scrollHeight, value }: { scrollHeight: number; value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useAutoGrow(ref, value, 200)
  return (
    <textarea
      readOnly
      ref={(el) => {
        ref.current = el
        if (el)
          Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight })
      }}
      value={value}
    />
  )
}

describe('useAutoGrow', () => {
  it('fits the box to its text, then stops at the cap and scrolls', () => {
    const { container, rerender } = render(<Box scrollHeight={64} value={'a\nb'} />)
    const box = container.querySelector('textarea') as HTMLTextAreaElement
    expect(box.style.height).toBe('64px')
    expect(box.style.overflowY).toBe('hidden')
    rerender(<Box scrollHeight={420} value={'a\nb\nc\nd\ne\nf\ng\nh\ni\nj'} />)
    expect(box.style.height).toBe('200px')
    expect(box.style.overflowY).toBe('auto')
  })
})
