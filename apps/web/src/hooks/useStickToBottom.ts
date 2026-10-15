import { useCallback, useEffect, useRef, useState } from 'react'

// Distance from the bottom (px) within which the view counts as "pinned" and keeps auto-following.
// A little tolerance absorbs sub-pixel rounding at fractional zoom / device-pixel ratios.
const PIN_THRESHOLD_PX = 32

/**
 * Pin-to-bottom for a scrolling log (chat timeline, event stream).
 *
 * The view auto-follows new content while the user is at the bottom, and stops the moment they scroll
 * up to read history (re-pinning when they scroll back down). The follow is driven by a
 * `ResizeObserver` on the content - not a React effect - so it tracks EVERY height change: streamed
 * tokens, markdown reflow, and images that load after commit, none of which reliably coincide with a
 * re-render.
 *
 * Wire `viewportRef` to the scrolling element (`flex-1 min-h-0 overflow-y-auto`, inside a flex column -
 * never `height:100%`, which doesn't resolve against a stretched flex item) and `contentRef` to the
 * single child that wraps the scrollable content. `contentRef` is a callback ref so the observer wires
 * up whenever the content mounts - including a content pane that renders only after a later re-render
 * (e.g. StoryModeCanvas's pre-artifact -> artifact flip), which a mount-only effect would miss.
 *
 * Scrolling is an instant `scrollTop = scrollHeight`, not smooth. The write still needs a
 * programmatic-scroll guard: the `scroll` event it dispatches is delivered a frame later, and while
 * content is streaming it will have grown again by then, so the handler would measure a distance past
 * the threshold and release the pin - the follow reading as the reader scrolling away.
 */
export function useStickToBottom<TViewport extends HTMLElement>() {
  const viewportRef = useRef<null | TViewport>(null)
  const [content, setContent] = useState<HTMLDivElement | null>(null)
  const [footer, setFooter] = useState<HTMLDivElement | null>(null)
  // Start pinned so the initial backlog lands at the bottom.
  const pinnedRef = useRef(true)

  // Callback ref: capturing the node in state re-runs the effect below when the content mounts, so
  // wiring survives content that appears after the hook's initial render. The viewport is an ancestor
  // of the content, so it is committed (its ref set) by the time this content-driven effect runs.
  const contentRef = useCallback((node: HTMLDivElement | null) => setContent(node), [])
  // Optional: a sticky footer docked in the same scroll flow (e.g. Workbench's mainFooter) is a flow
  // SIBLING of content, not a resize of content or viewport, so without observing it directly its
  // mount/resize never triggers a re-pin even though it grows scrollHeight.
  const footerRef = useCallback((node: HTMLDivElement | null) => setFooter(node), [])

  // Re-arms the follow for an explicit user action that is itself a request to see the newest content
  // (sending a message). Such an action outranks wherever the reader had scrolled to -- including a
  // scroll up into history, which releases the pin.
  //
  // Re-arms only, deliberately: the observer below does the scrolling once the new content lands.
  // Writing scrollTop here instead would land at the PRE-content bottom, and the scroll event that
  // write dispatches arrives after the content has rendered -- so the handler below would measure a
  // distance past the threshold and release the pin again, leaving the caller worse off than before.
  const pin = useCallback(() => {
    pinnedRef.current = true
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !content) {
      return
    }

    const distanceFromBottom = () =>
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight

    // Set while a write below is in flight, so the `scroll` event it dispatches re-affirms the pin
    // instead of re-deriving it from a distance that streamed content has already invalidated.
    let isSelfScrolling = false

    // A user scroll re-evaluates pinned-ness; our own follow never un-pins us.
    const onScroll = () => {
      if (isSelfScrolling) {
        isSelfScrolling = false
        return
      }
      pinnedRef.current = distanceFromBottom() <= PIN_THRESHOLD_PX
    }
    viewport.addEventListener('scroll', onScroll, { passive: true })

    // Guarded write. Skips when the browser would land where we already are, because such a no-op
    // assignment dispatches no scroll event and would leave the guard armed to swallow the reader's
    // next real scroll. Clamped at 0 for content that does not overflow, where the raw difference is
    // negative and every write is one of those silent no-ops.
    const followToBottom = () => {
      const landsAt = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      if (Math.abs(viewport.scrollTop - landsAt) < 1) {
        return
      }
      isSelfScrolling = true
      viewport.scrollTop = viewport.scrollHeight
    }

    // The crux: follow every height change while pinned. Observe the content (new/streamed messages)
    // AND the viewport - the composer is a shrink-0 sibling, so adding attachment chips shrinks the
    // viewport's clientHeight without changing content size, which would otherwise push the latest
    // bubble below the fold. Fires once on observe, so already present content pins on mount too.
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) {
        followToBottom()
      }
    })
    observer.observe(content)
    observer.observe(viewport)
    if (footer) {
      observer.observe(footer)
    }

    return () => {
      viewport.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  }, [content, footer])

  return { contentRef, footerRef, pin, viewportRef }
}
