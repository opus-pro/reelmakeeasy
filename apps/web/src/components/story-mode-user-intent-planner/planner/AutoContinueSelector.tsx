'use client'

import { cn } from '@shared/ui'
import { useAtomValue } from 'jotai'
import {
  type ComponentType,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

import { CheckMark, ClockChange, Cursor } from '@/components/icons/core'

import { persistAutoContinue } from '../state/actions/flow-actions'
import { getRenderStateAtom } from '../state/atoms/planner'
import { getIsAutoModeAtom } from '../state/computed/planner'
import { usePlannerState } from '../state/planner-context'

interface ModeOption {
  /** Whether picking this option turns auto-continue on. */
  auto: boolean
  description: string
  icon: ComponentType<{ className?: string }>
  label: string
}

/** Gap between the trigger's top edge and the menu's bottom edge. */
const MENU_GAP_PX = 6

/** Fallback for --dropdown-close-dur, used only if the class has not applied. */
const MENU_CLOSE_MS = 150

/**
 * The menu outlives its own dismissal, so the closing transition has time to run.
 *
 * 'closing' is a real state rather than a class toggle because the menu is
 * portalled and conditionally rendered - unmounting on click would take the node
 * away mid-transition and the close would simply not be seen.
 */
type MenuPhase = 'closed' | 'closing' | 'open'

const MODE_OPTIONS: readonly ModeOption[] = [
  {
    auto: true,
    description:
      'Agent still asks, but if you step away it fills in the details and generates your video.',
    icon: ClockChange,
    label: 'Auto',
  },
  {
    auto: false,
    description: 'Agent waits for your reply before every step, so nothing runs on its own.',
    icon: Cursor,
    label: 'Manual',
  },
]

/**
 * In-session auto-continue control, shown in the composer. Flips the
 * per-session setting mid-session: "Auto" keeps the 5-min review gate timers
 * (legacy behavior); "Manual" disarms them so the planner pauses at every review
 * until the user acts. The value mirrors renderState.autoContinueEnabled (server
 * state), with an optimistic flip in the planner API.
 *
 * Interactivity matches the composer's send-message availability: usable while
 * the session is active and not locked (including while the planner is
 * "Thinking" -- like queueing a message), disabled once creation locks the
 * session or it reaches a terminal status. It only changes what happens at a
 * timed review gate, so flipping it before one is reached is intentionally
 * silent until then.
 *
 * Hand-rolled controlled popover (not the shared Radix DropdownMenu): the
 * composer sits under the planner's pointer-events overlay layers and the
 * Lexical editor, which swallow the pointerdown the Radix trigger opens on, so
 * the menu never opened here. Plain onClick + a click-catching backdrop is
 * reliable in this container.
 */
export function AutoContinueSelector() {
  const state = usePlannerState()
  const renderState = useAtomValue(getRenderStateAtom(state))
  const enabled = useAtomValue(getIsAutoModeAtom(state))
  const canInteract = renderState.status === 'active' && !renderState.isLocked
  const [phase, setPhase] = useState<MenuPhase>('closed')
  // Held one frame at the pre-open scale so the browser has a state to animate
  // FROM. Applying .is-open on the first paint would show the menu already open.
  const [entered, setEntered] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<null | ReturnType<typeof setTimeout>>(null)
  const [anchor, setAnchor] = useState<null | { bottom: number; right: number }>(null)
  const open = phase === 'open'
  const mounted = phase !== 'closed'

  const closeMenu = useCallback(() => {
    // Hand focus back before the node goes, whether the dismissal was Escape, a
    // selection or an outside click - a click leaves focus on the body, which is
    // fine, but a keyboard dismissal must not lose the user's place.
    if (menuRef.current?.contains(document.activeElement)) {
      triggerRef.current?.focus()
    }
    setPhase((prev) => (prev === 'open' ? 'closing' : prev))
  }, [])

  const openMenu = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    setEntered(false)
    setPhase('open')
  }, [])

  /**
   * Where the portalled menu sits, measured from the trigger.
   *
   * The menu renders into document.body rather than beside the trigger, because
   * the composer shell carries a backdrop-filter and so is a backdrop root: a
   * blur on a descendant has nothing behind it to blur (measured - blur(40px)
   * computes and changes nothing). Out at body level the transcript IS behind it,
   * which is what the design draws.
   *
   * Anchored bottom-right because that is the corner the menu shares with the
   * trigger; `bottom`/`right` rather than `top`/`left` so the box grows upward and
   * leftward as the copy does, exactly as `bottom-full right-0` did when it was a
   * child.
   */
  const placeMenu = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) {
      return
    }
    setAnchor({
      bottom: window.innerHeight - rect.top + MENU_GAP_PX,
      right: window.innerWidth - rect.right,
    })
  }, [])

  // Measured before paint, so the menu never shows for a frame at the wrong place.
  useLayoutEffect(() => {
    if (!open) {
      return
    }
    placeMenu()
    // Close on scroll rather than tracking it: this popover lives only until a
    // click, and a menu that follows a scrolling transcript is stranger than one
    // that gets out of the way.
    window.addEventListener('scroll', closeMenu, { capture: true, passive: true })
    window.addEventListener('resize', placeMenu)
    return () => {
      window.removeEventListener('scroll', closeMenu, { capture: true })
      window.removeEventListener('resize', placeMenu)
    }
  }, [closeMenu, open, placeMenu])

  // One frame after the node exists, flip it open so the transition has somewhere
  // to travel from, and put focus on the option that is currently set.
  //
  // The menu is portalled to <body>, so it is nowhere near the trigger in the tab
  // order - without this, opening it leaves a keyboard user's focus behind on the
  // trigger with no way to reach the options.
  useEffect(() => {
    if (phase !== 'open' || entered) {
      return
    }
    const frame = requestAnimationFrame(() => {
      setEntered(true)
      const options = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
      const checked = [...(options ?? [])].find((el) => el.getAttribute('aria-checked') === 'true')
      ;(checked ?? options?.[0])?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [entered, phase])

  // Escape dismisses, and focus goes back to the trigger on the way out - otherwise
  // it would be stranded on a node that is about to leave the document. Bound to the
  // window rather than the menu so it still fires if focus has moved off the options.
  useEffect(() => {
    if (!open) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      event.stopPropagation()
      closeMenu()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeMenu, open])

  // Unmount only after the closing transition has run. The duration is read off
  // the element, so the CSS stays the single source of truth for it.
  useEffect(() => {
    if (phase !== 'closing') {
      return
    }
    const declared = menuRef.current
      ? Number.parseFloat(
          getComputedStyle(menuRef.current).getPropertyValue('--dropdown-close-dur'),
        )
      : Number.NaN
    const ms = Number.isFinite(declared) && declared > 0 ? declared : MENU_CLOSE_MS
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null
      setPhase('closed')
    }, ms)
    return () => {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current)
        closeTimer.current = null
      }
    }
  }, [phase])

  const select = useCallback(
    (next: boolean) => {
      closeMenu()
      void persistAutoContinue(state, next)
    },
    [closeMenu, state],
  )

  const active = enabled ? MODE_OPTIONS[0] : MODE_OPTIONS[1]
  const ActiveIcon = active.icon

  return (
    <div className="mr-2 self-end">
      {mounted && anchor
        ? createPortal(
            <>
              {/* Full-viewport backdrop closes the menu on any outside click
                  without relying on document pointer listeners (which the editor
                  intercepts). Portalled with the menu so it still sits under it. */}
              <div
                className="fixed inset-0 z-modal"
                data-testid="uip-auto-continue-backdrop"
                onClick={closeMenu}
              />
              <div
                // Rendered into document.body and positioned from the trigger's
                // rect - see placeMenu above for why it cannot stay a child of the
                // composer. z-modal, not the old z-50: at body level it negotiates
                // with the app's own scale rather than the shell's local one.
                //
                // 332px overall. 320 of that is the Menu Button inside 6px padding
                // each side, and an earlier 324 put those 6px on the description
                // column instead - at 234 the last word wrapped to a third line, at
                // 236 the copy fits the two the design shows.
                //
                // The menu is right-anchored to a trigger already ~70px in from the
                // viewport edge, so a fixed width starts off-screen on a 360-390px
                // mobile dock (measured -35px at 360 when this was 324). The clamp
                // keeps a gutter on the narrow planner and never binds above ~420px,
                // where 332 wins.
                //
                // t-dropdown (transitions.dev 05) grows it from the corner it
                // shares with the trigger. bottom-right, matching the anchoring
                // above - scaling from its own centre would read as a surface
                // appearing next to the chip rather than out of it.
                className={cn(
                  'fixed z-modal flex w-[332px] max-w-[calc(100vw_-_5.5rem)] flex-col overflow-hidden rounded-[16px] bg-menu-background p-1.5 shadow-lg backdrop-blur-2xl',
                  't-dropdown',
                  phase === 'open' && entered && 'is-open',
                  phase === 'closing' && 'is-closing',
                )}
                data-origin="bottom-right"
                ref={menuRef}
                role="menu"
                style={{ bottom: anchor.bottom, right: anchor.right }}
              >
                {/* No "Mode" heading. The design carries one, but over
                    exactly two rows named Auto and Manual it restates what the
                    options already say - and it cost 38px of a menu that opens
                    over the transcript. */}
                {MODE_OPTIONS.map((option) => (
                  <AutoContinueOption
                    checked={option.auto === enabled}
                    key={option.label}
                    onSelect={() => select(option.auto)}
                    option={option}
                  />
                ))}
              </div>
            </>,
            document.body,
          )
        : null}

      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`${active.label} mode is on, open to change`}
        className={cn(
          'inline-flex h-[38px] items-center gap-1.5 rounded-full px-2.5 text-sm font-medium text-white transition',
          canInteract ? 'cursor-pointer hover:bg-white/10' : 'cursor-default opacity-40',
          open && 'bg-white/10',
        )}
        data-testid="uip-auto-continue-trigger"
        disabled={!canInteract}
        onClick={() => (open ? closeMenu() : openMenu())}
        ref={triggerRef}
        type="button"
      >
        {/* Icon and label together, so one band crosses both - see .uip-auto-shine
            in tailwind.css for why the sweep belongs to the chip rather than to
            either child. The white copy is aria-hidden; the base underneath is
            what gets read. Manual stays plain - it is the quiet mode. */}
        {enabled ? (
          <span className="uip-auto-shine">
            <ActiveIcon className="size-4.5 shrink-0" />
            <span>{active.label}</span>
            <span aria-hidden className="uip-auto-shine-top">
              <ActiveIcon className="size-4.5 shrink-0" />
              <span>{active.label}</span>
            </span>
          </span>
        ) : (
          <>
            <ActiveIcon className="size-4.5 shrink-0" />
            <span>{active.label}</span>
          </>
        )}
      </button>
    </div>
  )
}

function AutoContinueOption({
  checked,
  onSelect,
  option,
}: {
  checked: boolean
  onSelect: () => void
  option: ModeOption
}) {
  const Icon = option.icon
  return (
    <button
      aria-checked={checked}
      // No fill on the selected row: the check mark already says which one it is,
      // and a tinted row on top of it made the same statement twice, so the
      // row stays flat. Hover keeps its own fill, which is a different
      // statement (where the pointer is, not what is chosen).
      className="flex w-full items-center gap-2.5 rounded-md p-2.5 text-left transition hover:bg-white/5"
      onClick={onSelect}
      role="menuitemradio"
      type="button"
    >
      <Icon className="size-5 shrink-0 text-white" />
      {/* px-0.5 is Figma's 2px on the Plan Info frame, so the label does not sit
          flush against the icon. The title row is a fixed 20px there, which is
          what label-sm's 17px line plus that box already gives. */}
      <span className="min-w-0 flex-1 px-0.5">
        <span className="flex h-5 items-center text-label-sm text-primary">{option.label}</span>
        <span className="block text-body-xs text-secondary">{option.description}</span>
      </span>
      <CheckMark className={cn('size-5 shrink-0 text-white', !checked && 'opacity-0')} />
    </button>
  )
}
