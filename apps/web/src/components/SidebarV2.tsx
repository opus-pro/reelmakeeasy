import { cn } from '@shared/ui'
import { usePathname, useRouter } from 'next/navigation'
import React, { memo, useMemo, useState } from 'react'

import {
  ClipsVertical,
  Compass,
  Cross as X,
  LearningCenter,
  Settings,
  ThreeLines as Menu,
  VideoCards,
} from '@/components/icons/core'
import { useRefCallback } from '@/hooks/use-ref-callback'

import { LogoWithText } from './NavigateBar'

export const SIDEBAR_WIDTH = 212

interface NavConfigItem {
  contexts: NavContext[]
  externalUrl?: string
  icon: NavIcon
  isActive?: (pathname: string) => boolean
  key: string
  label: string
  path?: string
  section: NavSection
  tag?: string
}
type NavContext = 'desktop' | 'mobile'
type NavIcon = React.ComponentType<{ className?: string }>

interface NavItemProps {
  highlighted?: boolean
  icon: NavIcon
  isActive?: boolean
  label: string
  /** Stable nav key exposed as `data-nav-key` so floating surfaces (e.g. the
   *  Brand Library discovery tooltip) can anchor to a specific item. */
  navKey?: string
  onClick: () => void
  tag?: string
}
type NavSection = 'main' | 'support' | 'tools'

interface SidebarV2Props {
  className?: string
}

const NAV_SECTION_ORDER: NavSection[] = ['main', 'tools', 'support']

/** Tools: each makes one kind of short, with the agent (Easy or Advanced) or by hand. */
const NAV_SECTION_TITLE: Partial<Record<NavSection, string>> = {
  tools: 'Tools',
}

const NAV_ITEMS: NavConfigItem[] = [
  {
    contexts: ['desktop', 'mobile'],
    icon: Compass,
    isActive: (pathname) => pathname.startsWith('/home'),
    key: 'home',
    label: 'Home',
    path: '/home',
    section: 'main',
  },
  {
    contexts: ['desktop', 'mobile'],
    icon: VideoCards,
    isActive: (pathname) => pathname.startsWith('/projects'),
    key: 'projects',
    label: 'My projects',
    path: '/projects',
    section: 'main',
  },
  {
    contexts: ['desktop', 'mobile'],
    icon: ClipsVertical,
    isActive: (pathname) => pathname.startsWith('/ranking'),
    key: 'ranking',
    label: 'Ranking Builder',
    path: '/ranking',
    section: 'tools',
  },
  {
    contexts: ['desktop', 'mobile'],
    icon: Settings,
    isActive: (pathname) => pathname.startsWith('/setup'),
    key: 'setup',
    label: 'Setup',
    path: '/setup',
    section: 'support',
  },
  {
    contexts: ['desktop', 'mobile'],
    externalUrl: 'https://github.com/opus-pro/reelmakeeasy',
    icon: LearningCenter,
    key: 'help',
    label: 'Help',
    section: 'support',
  },
]

const NavItem: React.FC<NavItemProps> = memo(
  ({ highlighted, icon: Icon, isActive, label, navKey, onClick, tag }) => (
    <div
      className={cn(
        'self-stretch h-[38px] px-2.5 rounded-sm inline-flex justify-center items-center gap-1.5 transition-colors cursor-pointer',
        isActive || highlighted ? 'bg-white/10' : 'hover:bg-white/5',
      )}
      data-nav-key={navKey}
      onClick={onClick}
    >
      <div className="relative size-4.5 text-white">
        <Icon className="size-4.5" />
      </div>
      <div className="flex-1 px-0.5 flex justify-center items-center gap-2.5">
        <div className="flex-1 text-left text-white text-sm font-medium leading-4">{label}</div>
      </div>
      {tag && (
        <div className="text-right text-accent-orange text-sm font-medium leading-4">{tag}</div>
      )}
    </div>
  ),
)

const SidebarV2: React.FC<SidebarV2Props> = ({ className }) => {
  const router = useRouter()
  const pathname = usePathname()
  const pathnameValue = pathname ?? ''
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const handleNavigation = useRefCallback((path: string) => {
    router.push(path)
  })

  const onNavItemClick = useRefCallback((item: NavConfigItem, context: NavContext) => {
    if (context === 'mobile') {
      setMobileMenuOpen(false)
    }

    if (item.path) {
      handleNavigation(item.path)
      return
    }

    if (item.externalUrl) {
      window.open(item.externalUrl, '_blank', 'noopener,noreferrer')
    }
  })

  const clickHandlersByContext = useMemo(() => {
    const makeHandlers = (context: NavContext) =>
      Object.fromEntries(
        NAV_ITEMS.map((item) => [item.key, () => onNavItemClick(item, context)]),
      ) as Record<string, () => void>

    return {
      desktop: makeHandlers('desktop'),
      mobile: makeHandlers('mobile'),
    }
  }, [onNavItemClick])

  const getSectionItems = useRefCallback((section: NavSection, context: NavContext) =>
    NAV_ITEMS.filter((item) => {
      if (item.section !== section) {
        return false
      }

      if (!item.contexts.includes(context)) {
        return false
      }

      return true
    }),
  )

  const renderNavSection = useRefCallback((section: NavSection, context: NavContext) => {
    const items = getSectionItems(section, context)

    if (items.length === 0) {
      return null
    }

    const handlers = clickHandlersByContext[context]
    const sectionTitle = NAV_SECTION_TITLE[section]

    return (
      <div
        className="self-stretch rounded-2xl backdrop-blur-[20px] flex flex-col gap-0.5"
        key={`${context}-${section}`}
      >
        {sectionTitle && (
          <div className="px-2.5 py-2 text-sm font-medium leading-4 text-secondary">
            {sectionTitle}
          </div>
        )}
        {items.map((item) => (
          <NavItem
            icon={item.icon}
            isActive={item.isActive?.(pathnameValue)}
            key={item.key}
            label={item.label}
            navKey={item.key}
            onClick={handlers[item.key]}
            tag={item.tag}
          />
        ))}
      </div>
    )
  })

  return (
    <>
      {/* Mobile Top Bar */}
      <div className="md:hidden fixed top-[var(--global-top-banner-height,0px)] inset-x-0 z-[60] h-14 pl-4 pr-2 bg-neutral-900 inline-flex justify-between items-center">
        <div className="flex-1 h-[38px] flex justify-start items-center">
          <LogoWithText />
        </div>
        <div className="flex justify-start items-center gap-2">
          <button
            className="h-9 min-w-9 px-2.5 rounded-sm flex justify-center items-center gap-1.5 hover:bg-white/5 transition-colors"
            onClick={() => setMobileMenuOpen(true)}
          >
            <Menu className="size-4 text-white" />
          </button>
        </div>
      </div>

      {/* Mobile Full-Screen Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-[70] bg-UI-menu-background/80 backdrop-blur-2xl flex flex-col overflow-y-auto">
          <div className="h-14 pl-4 pr-2 flex justify-between items-center shrink-0">
            <div className="flex-1 h-[38px] flex justify-start items-center">
              <LogoWithText />
            </div>
            <button
              className="h-9 min-w-9 px-2.5 rounded-sm flex justify-center items-center gap-1.5 hover:bg-white/5 transition-colors"
              onClick={() => setMobileMenuOpen(false)}
            >
              <X className="size-4 text-white" />
            </button>
          </div>

          <div className="px-2.5 flex flex-col gap-2">
            <div className="h-px bg-white/10" />

            {NAV_SECTION_ORDER.map((section, index) => {
              if (section === 'support') {
                return null
              }
              return (
                <React.Fragment key={`mobile-${section}`}>
                  {renderNavSection(section, 'mobile')}
                  {index === 1 && <div className="h-px bg-white/10" />}
                </React.Fragment>
              )
            })}
            {renderNavSection('support', 'mobile')}
          </div>
        </div>
      )}

      {/* Desktop Sidebar: the app's main navigation landmark. */}
      <nav
        aria-label="Main"
        className={cn(
          'hidden md:flex sticky pl-3 py-3 border-white/10 flex-col justify-center items-start gap-6 z-40 overflow-y-auto',
          className,
        )}
        data-dashboard-sidebar-sticky-root
        style={{
          height: 'calc(100dvh - var(--global-top-banner-height, 0px))',
          top: 'var(--global-top-banner-height, 0px)',
          width: `${SIDEBAR_WIDTH}px`,
        }}
      >
        {/* Logo */}
        <div
          className="self-stretch h-[38px] px-2.5 inline-flex justify-start items-center"
          data-sidebar-logo
        >
          <LogoWithText />
        </div>

        {NAV_SECTION_ORDER.map((section) => {
          if (section === 'support') {
            return null
          }
          return renderNavSection(section, 'desktop')
        })}

        {/* Spacer */}
        <div className="self-stretch flex-1" />

        {/* Bottom Section */}
        <div className="self-stretch rounded-2xl backdrop-blur-xl flex flex-col justify-start items-start">
          {renderNavSection('support', 'desktop')}
        </div>
      </nav>
    </>
  )
}

export default memo(SidebarV2)
