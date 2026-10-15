'use client'

import * as RadixMenu from '@radix-ui/react-dropdown-menu'
import { ChevronRightIcon } from '@radix-ui/react-icons'
import * as React from 'react'

import { cn } from '../../lib/utils'

// Shared look for the floating panels (main menu and submenus): popover
// surface, rounded, and a short fade/zoom/slide when they open and close.
const panelBase =
  'z-50 min-w-[8rem] overflow-hidden rounded-md bg-popover p-1 text-popover-foreground'
const panelMotion = [
  'data-[state=open]:animate-in data-[state=closed]:animate-out',
  'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
  'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
  'data-[side=top]:slide-in-from-bottom-2 data-[side=bottom]:slide-in-from-top-2',
  'data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2',
].join(' ')

// One menu row: a highlighted background on keyboard/pointer focus (and, from the keyboard,
// the global focus outline inside its edge), dimmed and inert when disabled, and
// direct-child icons sized to 16px.
const rowBase =
  'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0'

/**
 * Tab and Shift+Tab move to the next and previous row of an open menu, wrapping at either end,
 * so keyboard focus stays in the menu as it would in a dialog (Escape still closes it). Radix
 * follows the WAI-ARIA menu pattern, where only the arrow keys move and Tab does nothing.
 * Rows of a submenu belong to its own panel and are left to it.
 */
export function tabThroughRows(event: React.KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return
  const panel = event.currentTarget
  const rows = [...panel.querySelectorAll<HTMLElement>('[role^="menuitem"]')].filter(
    (row) => !row.hasAttribute('data-disabled') && row.closest('[role="menu"]') === panel,
  )
  if (!rows.length) return
  event.preventDefault()
  const at = rows.indexOf(document.activeElement as HTMLElement)
  const step = event.shiftKey ? -1 : 1
  const next =
    at === -1 ? (step > 0 ? 0 : rows.length - 1) : (at + step + rows.length) % rows.length
  rows[next]?.focus()
}

/** Holds the open/closed state of a dropdown menu. */
export const DropdownMenuRoot: React.FC<RadixMenu.DropdownMenuProps> = RadixMenu.Root

/** The element that opens the menu (use `asChild` to keep your own button). */
export const DropdownMenuTrigger = RadixMenu.Trigger

export const DropdownMenuGroup = RadixMenu.Group
export const DropdownMenuPortal = RadixMenu.Portal
export const DropdownMenuSub = RadixMenu.Sub

/** The floating panel, rendered in a portal and offset 4px from the trigger by default. */
export const DropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof RadixMenu.Content>,
  React.ComponentPropsWithoutRef<typeof RadixMenu.Content>
>(({ className, onKeyDown, sideOffset = 4, ...props }, ref) => (
  <RadixMenu.Portal>
    <RadixMenu.Content
      className={cn(panelBase, 'border shadow-md', panelMotion, className)}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (!event.defaultPrevented) tabThroughRows(event)
      }}
      ref={ref}
      sideOffset={sideOffset}
      {...props}
    />
  </RadixMenu.Portal>
))
DropdownMenuContent.displayName = 'DropdownMenuContent'

/** One selectable row; `inset` lines its text up with rows that have a leading icon. */
export const DropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof RadixMenu.Item>,
  React.ComponentPropsWithoutRef<typeof RadixMenu.Item> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <RadixMenu.Item className={cn(rowBase, inset && 'pl-8', className)} ref={ref} {...props} />
))
DropdownMenuItem.displayName = 'DropdownMenuItem'

/** Bold, non-interactive heading row. */
export const DropdownMenuLabel = React.forwardRef<
  React.ComponentRef<typeof RadixMenu.Label>,
  React.ComponentPropsWithoutRef<typeof RadixMenu.Label> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <RadixMenu.Label
    className={cn('px-2 py-1.5 text-sm font-semibold', inset && 'pl-8', className)}
    ref={ref}
    {...props}
  />
))
DropdownMenuLabel.displayName = 'DropdownMenuLabel'

/** Thin horizontal rule between groups of rows. */
export const DropdownMenuSeparator = React.forwardRef<
  React.ComponentRef<typeof RadixMenu.Separator>,
  React.ComponentPropsWithoutRef<typeof RadixMenu.Separator>
>(({ className, ...props }, ref) => (
  <RadixMenu.Separator className={cn('-mx-1 my-1 h-px bg-muted', className)} ref={ref} {...props} />
))
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator'

/** Row that opens a nested menu; shows a chevron on the right. */
export const DropdownMenuSubTrigger = React.forwardRef<
  React.ComponentRef<typeof RadixMenu.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof RadixMenu.SubTrigger> & { inset?: boolean }
>(({ children, className, inset, ...props }, ref) => (
  <RadixMenu.SubTrigger
    className={cn(
      'flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm focus:bg-accent data-[state=open]:bg-accent [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
      inset && 'pl-8',
      className,
    )}
    ref={ref}
    {...props}
  >
    {children}
    <ChevronRightIcon className="ml-auto" />
  </RadixMenu.SubTrigger>
))
DropdownMenuSubTrigger.displayName = 'DropdownMenuSubTrigger'

/** Floating panel of a nested menu (not portaled; wrap it in DropdownMenuPortal if needed). */
export const DropdownMenuSubContent = React.forwardRef<
  React.ComponentRef<typeof RadixMenu.SubContent>,
  React.ComponentPropsWithoutRef<typeof RadixMenu.SubContent>
>(({ className, onKeyDown, ...props }, ref) => (
  <RadixMenu.SubContent
    className={cn(panelBase, 'border shadow-lg', panelMotion, className)}
    onKeyDown={(event) => {
      onKeyDown?.(event)
      if (!event.defaultPrevented) tabThroughRows(event)
    }}
    ref={ref}
    {...props}
  />
))
DropdownMenuSubContent.displayName = 'DropdownMenuSubContent'
