'use client'

import { Button, cn } from '@shared/ui'
import { useSetAtom } from 'jotai'
import { useEffect, useLayoutEffect, useState } from 'react'

import { type EnterPromptCtaState, enterPromptCtaStateAtom } from '@/atom/ui'
import { AddImage, ArrowUp } from '@/components/icons/core'
import { useSidebarVariant } from '@/components/sidebar-config'
import { useBreakpoint } from '@/util/browserUtils'

interface EnterPromptCtaProps {
  onFocus?: () => void
  text: string
  visible?: boolean
}

export function EnterPromptCta({ text, onFocus, visible = true }: EnterPromptCtaProps) {
  const { isBelowMd } = useBreakpoint('md')
  const { sidebarDesktopWidth } = useSidebarVariant()
  const hasScrolled = useHasWindowScrolled()
  const setEnterPromptCtaState = useSetAtom(enterPromptCtaStateAtom)
  // The pill is expanded only at the top of the page. Once the user scrolls away
  // from the top, it stays compact until they return to top.
  const isExpanded = !hasScrolled
  let enterPromptCtaState: EnterPromptCtaState = 'not-present'
  if (visible) {
    enterPromptCtaState = isExpanded ? 'expanded' : 'collapsed'
  }

  // Single source of truth for the expand/collapse morph so the pill and its
  // inner overlay animate with identical timing.
  // Collapse is quick (100ms, it fires mid-scroll where main-thread time is scarce);
  // expand is slower and smoother (200, it happens at rest). The compact radius is half the
  // compact height (52px) so it renders as a pill yet interpolates smoothly to rounded-3xl.
  const morph = isExpanded
    ? {
        duration: 'duration-200',
        pillHeight: 'h-[100px]',
        radius: 'rounded-3xl',
      }
    : {
        duration: 'duration-100',
        pillHeight: 'h-[52px]',
        radius: 'rounded-[26px]',
      }

  useLayoutEffect(() => {
    setEnterPromptCtaState(enterPromptCtaState)
  }, [enterPromptCtaState, setEnterPromptCtaState])

  useLayoutEffect(() => {
    return () => setEnterPromptCtaState('not-present')
  }, [setEnterPromptCtaState])

  return (
    <Button
      aria-hidden={!visible}
      className={cn(
        'fixed z-[45] pl-4 pr-2 py-2 bg-UI-menu-background backdrop-blur-2xl inline-flex items-start justify-between overflow-hidden border-0 md:hover:bg-UI-menu-background/70 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
        'max-md:w-auto max-md:max-w-none md:w-96 md:max-w-[calc(100vw-2rem)]',
        'bottom-[var(--mobile-bottom-bar-height)] md:bottom-6',
        morph.pillHeight,
        morph.radius,
        morph.duration,
        visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
      )}
      data-dd-action="enter-prompt-cta-button"
      onClick={onFocus}
      style={
        isBelowMd
          ? {
              left: '1rem',
              right: '1rem',
              transform: visible ? 'translateY(0)' : 'translateY(0.5rem)',
            }
          : {
              left: `calc(${sidebarDesktopWidth}px + (100vw - ${sidebarDesktopWidth}px) / 2)`,
              transform: visible ? 'translateX(-50%)' : 'translateX(-50%) translateY(0.5rem)',
            }
      }
      tabIndex={visible ? 0 : -1}
      type="button"
      variant="base"
    >
      <div
        aria-hidden
        className={cn(
          'absolute inset-0 bg-[rgba(122,122,122,0.5)] pointer-events-none transition-all',
          morph.radius,
          morph.duration,
        )}
      />
      <div className="flex items-center justify-start py-1 gap-2 min-w-0">
        <AddImage className="size-6 shrink-0 text-white" />
        <div className="truncate text-base font-normal leading-6 text-white/50">{text}</div>
      </div>
      <div className="size-9 flex justify-center items-center self-end bg-white/30 rounded-full flex-shrink-0">
        <ArrowUp className="text-white size-4" />
      </div>
    </Button>
  )
}

function useHasWindowScrolled() {
  const [hasScrolled, setHasScrolled] = useState(
    () => typeof window !== 'undefined' && window.scrollY > 0,
  )

  useEffect(() => {
    const updateHasScrolled = () => setHasScrolled(window.scrollY > 0)

    updateHasScrolled()
    window.addEventListener('scroll', updateHasScrolled, { passive: true })
    return () => window.removeEventListener('scroll', updateHasScrolled)
  }, [])

  return hasScrolled
}
