'use client'

import { cn, Popover, Tooltip } from '@shared/ui'
import { AnimatePresence, motion } from 'framer-motion'
import { ReactNode, useEffect, useRef, useState } from 'react'

export type ContextMenuItem = {
  disabled?: boolean
  icon?: ReactNode
  label: ReactNode | string
  onClick?: () => void
  separator?: boolean
  submenu?: ReactNode
  suffix?: ReactNode
  /**
   * Hover hint, typically the reason a `disabled` row is disabled. Rendered
   * through a Tooltip wrapper because a native `title` on a disabled <button>
   * does not fire pointer events. Desktop-only by nature -- touch surfaces get
   * the muted disabled style and no hint.
   */
  tooltip?: string
}

interface ContextMenuItemsProps {
  itemClassName?: string
  items: ContextMenuItem[]
  onItemClick?: (item: ContextMenuItem) => void
}

interface ContextMenuRendererProps {
  isOpen: boolean
  itemClassName?: string
  items: ContextMenuItem[]
  maskClassName?: string
  menuClassName?: string
  onClickOutside?: () => void
  onClose: () => void
  position: { x: number; y: number }
}

/**
 * Renders the list of context menu items with separators.
 */
export function ContextMenuItems({ itemClassName, items, onItemClick }: ContextMenuItemsProps) {
  const [openSubmenuIndex, setOpenSubmenuIndex] = useState<null | number>(null)

  const handleItemClick = (item: ContextMenuItem) => {
    if (item.disabled) {
      return
    }
    item.onClick?.()
    onItemClick?.(item)
  }

  return (
    <div className="p-1.5">
      {items.map((item, index) => {
        const buttonClassName = cn(
          'text-primary hover:bg-secondary flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm transition-colors',
          item.disabled && 'text-tertiary cursor-not-allowed opacity-50',
          // Chrome suppresses pointer events on a disabled button entirely -- they do
          // not bubble either, so the Tooltip wrapper below would never see the hover.
          // Letting them through to the wrapper costs nothing: `disabled` still blocks
          // activation, and handleItemClick returns early regardless.
          item.disabled && item.tooltip && 'pointer-events-none',
          item.submenu && openSubmenuIndex === index && 'bg-secondary',
          itemClassName,
        )

        const buttonContent = (
          <>
            <span className="flex items-center gap-2 md:gap-1.5">
              {item.icon && <span className="flex-shrink-0">{item.icon}</span>}
              <span>{item.label}</span>
            </span>
            {item.suffix && <span className="flex-shrink-0">{item.suffix}</span>}
          </>
        )

        const ItemButton = (
          <button
            className={buttonClassName}
            disabled={item.disabled}
            onClick={(e) => {
              e.stopPropagation()
              if (!item.submenu) {
                e.preventDefault()
                handleItemClick(item)
              }
            }}
            type="button"
          >
            {buttonContent}
          </button>
        )

        // A disabled button swallows its own pointer events, so the Tooltip has to
        // sit on a wrapper element rather than the button itself.
        const TooltipWrappedItem = item.tooltip ? (
          <Tooltip
            className="rounded-xs bg-[#444444] px-2 py-1.5 text-sm font-medium text-white"
            content={item.tooltip}
            disablePersistedActivation
            portal
            // Right, not top: a vertical menu's own rows sit above, and a top-side
            // tooltip covers the neighbouring row while the reader is still scanning.
            side="right"
            sideOffset={6}
          >
            <span className="block w-full cursor-not-allowed">{ItemButton}</span>
          </Tooltip>
        ) : (
          ItemButton
        )

        return (
          <div key={index}>
            {item.separator && index > 0 && <div className="border-secondary my-1 border-t" />}
            {item.submenu ? (
              <Popover
                align="start"
                className="border-0 bg-transparent p-0 shadow-none"
                collisionPadding={{ bottom: 16, left: 8, right: 8, top: 8 }}
                content={item.submenu}
                onOpenChange={(open) => setOpenSubmenuIndex(open ? index : null)}
                open={openSubmenuIndex === index}
                side="right"
              >
                {ItemButton}
              </Popover>
            ) : (
              <>{TooltipWrappedItem}</>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Pure context menu renderer using Framer Motion.
 * Handles positioning, animations, and click-outside logic.
 * State management is controlled by parent via props.
 */
export function ContextMenuRenderer({
  isOpen,
  itemClassName,
  items,
  maskClassName,
  menuClassName,
  onClickOutside,
  onClose,
  position,
}: ContextMenuRendererProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [adjustedPosition, setAdjustedPosition] = useState(position)

  const handleItemClick = () => {
    onClose()
  }

  // Close on click outside
  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        e.stopImmediatePropagation()
        onClose()
        onClickOutside?.()
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside, true)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, onClose, onClickOutside])

  // Adjust menu position to stay within viewport
  useEffect(() => {
    if (!isOpen || !menuRef.current) {
      return
    }

    const menu = menuRef.current
    const rect = menu.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    let { x, y } = position

    // Adjust horizontal position
    if (x + rect.width > viewportWidth) {
      x = viewportWidth - rect.width - 8
    }

    // Adjust vertical position
    if (y + rect.height > viewportHeight) {
      y = viewportHeight - rect.height - 8
    }

    if (x !== position.x || y !== position.y) {
      setAdjustedPosition({ x, y })
    } else {
      setAdjustedPosition(position)
    }
  }, [isOpen, position])

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Transparent overlay to block all interactions */}
          <motion.div
            animate={{ opacity: 1 }}
            className={cn('fixed inset-0 z-[9998]', maskClassName)}
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            transition={{ duration: 0.1 }}
          />

          <motion.div
            animate={{ opacity: 1, scale: 1 }}
            className={cn(
              'bg-primary border-secondary fixed z-[9999] min-w-[180px] rounded-lg border shadow-lg',
              menuClassName,
            )}
            exit={{ opacity: 0, scale: 0.95 }}
            initial={{ opacity: 0, scale: 0.95 }}
            ref={menuRef}
            style={{
              left: adjustedPosition.x,
              top: adjustedPosition.y,
            }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            <ContextMenuItems
              itemClassName={itemClassName}
              items={items}
              onItemClick={handleItemClick}
            />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

/**
 * Hook to manage context menu state.
 * Returns state and handler that should be attached to onContextMenu prop of the target element.
 */
export function useContextMenu() {
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setPosition({ x: e.clientX, y: e.clientY })
    setIsOpen(true)
  }

  const open = (x: number, y: number) => {
    setPosition({ x, y })
    setIsOpen(true)
  }

  const close = () => {
    setIsOpen(false)
  }

  return {
    close,
    handleContextMenu,
    isOpen,
    open,
    position,
  }
}
