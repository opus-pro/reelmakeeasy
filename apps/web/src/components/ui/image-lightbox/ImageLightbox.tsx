'use client'

import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

import { CrossSmall } from '@/components/icons/core'
import { ExternalImage } from '@/components/ui/kit'

export interface ImageLightboxProps {
  alt: string
  onClose: () => void
  src: string
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Full-screen viewer for a single image, portalled to `document.body`.
 *
 * Mount it only while open; unmounting is what closes it, and what restores focus to
 * whatever was focused when it opened.
 *
 * `z-lightbox` sits above every dialog layer, including the `modal` dialogs it opens from and
 * the `modal-chrome` affordances above them. `pointer-events-auto` is what makes it usable
 * there: a Radix modal (`<Sheet>`, `<Dialog>`) sets `pointer-events: none` on `<body>`, and
 * this overlay is a `<body>` child, so without opting back in nothing here can be tapped.
 *
 * Tapping the backdrop or the image closes it - on mobile there is no Escape key and the
 * backdrop strip around a large image is too thin to tap reliably.
 */
export function ImageLightbox({ alt, onClose, src }: ImageLightboxProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  // Claim focus and hide the rest of the app, then undo both on close.
  //
  // These are one effect because the two are order-sensitive in opposite directions, and
  // splitting them across two effects gets that wrong at one end or the other: React runs
  // effects and their cleanups in declaration order. On the way in, the trigger must be read
  // before anything is marked `inert`, since marking an ancestor `inert` blurs what it
  // contains. On the way out, `inert` must be lifted before focus is handed back, since
  // focusing into an inert subtree is silently a no-op.
  //
  // Focus is moved here rather than with `autoFocus` for the same reason: React applies
  // `autoFocus` during commit, before this runs, so the trigger would be gone by then.
  useEffect(() => {
    const trigger = document.activeElement

    // The overlay portals straight into `document.body`, so it is one of these siblings.
    const hidden = [...document.body.children].filter(
      (el): el is HTMLElement => el !== overlayRef.current && el instanceof HTMLElement,
    )
    const previous = hidden.map((el) => ({
      ariaHidden: el.getAttribute('aria-hidden'),
      el,
      wasInert: el.hasAttribute('inert'),
    }))
    for (const el of hidden) {
      el.setAttribute('aria-hidden', 'true')
      el.setAttribute('inert', '')
    }
    closeButtonRef.current?.focus()

    return () => {
      for (const { ariaHidden, el, wasInert } of previous) {
        if (ariaHidden === null) {
          el.removeAttribute('aria-hidden')
        } else {
          el.setAttribute('aria-hidden', ariaHidden)
        }
        if (!wasInert) {
          el.removeAttribute('inert')
        }
      }
      if (trigger instanceof HTMLElement && document.contains(trigger)) {
        trigger.focus()
      }
    }
  }, [])

  // React routes portal events through the React tree, not the DOM tree, so anything the
  // overlay emits reaches the trigger that rendered it - and a trigger that reopens on click
  // or Enter/Space would undo every close. The overlay is modal: nothing outside it may react
  // to its events.
  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      onClose()
    },
    [onClose],
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      event.stopPropagation()
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') {
        return
      }
      // Trap: the overlay owns every focusable element while it is open, so cycle within it.
      const focusable = [
        ...(overlayRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []),
      ]
      if (focusable.length === 0) {
        event.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !overlayRef.current?.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !overlayRef.current?.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    },
    [onClose],
  )

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      aria-label="Image preview"
      aria-modal="true"
      className="pointer-events-auto fixed inset-0 z-lightbox flex cursor-pointer items-center justify-center bg-black/90"
      data-testid="image-lightbox"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      ref={overlayRef}
      role="dialog"
    >
      <button
        aria-label="Close image preview"
        className="absolute left-6 top-6 flex size-9.5 items-center justify-center rounded-full bg-fill-secondary text-primary transition-colors hover:bg-fill-hover"
        onClick={handleClick}
        ref={closeButtonRef}
        type="button"
      >
        <CrossSmall className="size-6" />
      </button>
      <ExternalImage
        alt={alt}
        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
        src={src}
      />
    </div>,
    document.body,
  )
}
