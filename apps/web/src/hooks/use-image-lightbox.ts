'use client'

import { useCallback, useMemo, useState } from 'react'

import { imageLightboxTriggerProps } from '@/components/ui/image-lightbox'

/**
 * Open/close state for `ImageLightbox`, bundled with the trigger props that open it.
 *
 * The lightbox view and its trigger contract are prop-pure and live in the UI incubator;
 * this is the stateful adapter, which the incubator's contract keeps out of that directory.
 * Several unrelated features share it, so it sits here rather than in any one of them.
 */
export function useImageLightbox(enabled: boolean) {
  const [isOpen, setIsOpen] = useState(false)

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])

  const triggerProps = useMemo(
    () => imageLightboxTriggerProps({ enabled, onOpen: open }),
    [enabled, open],
  )

  return { close, isOpen: isOpen && enabled, open, triggerProps }
}
