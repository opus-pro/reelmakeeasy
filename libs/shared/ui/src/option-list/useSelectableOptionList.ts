import { useEffect, useRef, useState } from 'react'

type KeyDownLike = { key: string; preventDefault: () => void }

/**
 * Behavior primitive for a "pick one of N rows" list: owns the active (keyboard/hover-highlighted)
 * index, arrow-key navigation, and Enter dispatch. Renders nothing -- callers own all visuals and
 * decide where handleKeyDown gets attached (a wrapping element's onKeyDown, or a window listener).
 */
export function useSelectableOptionList({
  count,
  onEnter,
}: {
  count: number
  onEnter: (index: number) => void
}) {
  const [activeIndex, setActiveIndex] = useState(0)
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([])

  // Keep the active index in range when the row count changes (e.g. options load in/out).
  useEffect(() => {
    setActiveIndex((previous) => Math.max(0, Math.min(previous, Math.max(count - 1, 0))))
  }, [count])

  function handleKeyDown(event: KeyDownLike) {
    if (count <= 0) {
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((previous) => Math.min(previous + 1, count - 1))
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((previous) => Math.max(previous - 1, 0))
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      onEnter(activeIndex)
    }
  }

  function registerRowRef(index: number) {
    return (el: HTMLButtonElement | null) => {
      rowRefs.current[index] = el
    }
  }

  return { activeIndex, handleKeyDown, registerRowRef, setActiveIndex }
}
