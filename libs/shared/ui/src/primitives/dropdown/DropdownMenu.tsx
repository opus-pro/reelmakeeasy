'use client'

import { CheckIcon } from '@radix-ui/react-icons'
import * as React from 'react'

import { cn } from '../../lib/utils'

import {
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './parts'

/** Callback for a clicked row (DropdownMenu `onClick` and MenuProps `onClick`). */
export type ItemClickHandler = (params: ItemClickParams) => void

/** The clicked row's key, and the keys from the top menu down to it. */
export type ItemClickParams = {
  e: React.MouseEvent<HTMLDivElement, MouseEvent>
  key: string
  path: string[]
}

/** One row of a DropdownMenu, a separator, or (with `children`) a nested submenu. */
export interface MenuProps {
  /** Submenu only: shift along the row's edge, in px. */
  alignOffset?: number
  /** `true` shows a check mark (see DropdownMenu's `checkPosition`). */
  checked?: boolean
  /** Rows of a submenu opened from this row. */
  children?: MenuProps[]
  className?: string
  disabled?: boolean
  icon?: React.ReactNode
  key?: string
  label?: React.ReactNode
  /** Runs before DropdownMenu's own `onClick`; the menu then closes. */
  onClick?: ItemClickHandler
  /** Submenu only: gap from this row, in px. */
  sideOffset?: number
  type?: 'item' | 'separator'
}

/** Props of DropdownMenu: a menu described by an `items` array, opened by `children`. */
export type DropdownMenuProps = Pick<
  React.ComponentProps<typeof DropdownMenuContent>,
  'align' | 'side' | 'sideOffset'
> & {
  /** Where the check mark of a `checked` row sits. Defaults to the right edge. */
  checkPosition?: 'left' | 'right'
  /** The trigger; it must accept a ref and props (a button, usually). */
  children?: React.ReactNode
  classNames?: Partial<Record<'content' | 'label' | 'subContent', string>>
  /** Keep the menu open when the user clicks or focuses outside it. */
  ignoreInteractOutside?: boolean
  items: MenuProps[]
  /** Heading shown above the rows, followed by a separator. */
  label?: React.ReactNode
  /**
   * Whether the menu blocks the rest of the page while open (default `true`).
   * Pass `false` when picking a row opens another overlay such as a dialog:
   * a modal menu sets `pointer-events: none` on `<body>`, and that can stick
   * after the dialog closes and freeze the page.
   */
  modal?: boolean
  /** Runs for every row clicked, in this menu or any submenu. */
  onClick?: ItemClickHandler
  onOpenChange?: (open: boolean) => void
  /** Controlled open state; leave it out to let the menu manage itself. */
  open?: boolean
  /** Make the trigger inert, so only `open` can show the menu. */
  triggerDisabled?: boolean
}

interface RowsProps {
  checkPosition: 'left' | 'right'
  items: MenuProps[]
  onClick?: ItemClickHandler
  parentPath: string[]
  subContentClassName?: string
}

function CheckMark({ placement }: { placement: 'left' | 'right' }) {
  return (
    <div
      className={cn(
        'flex size-4 shrink-0 items-center justify-center',
        placement === 'right' && 'absolute right-2',
      )}
    >
      <CheckIcon className="size-4" />
    </div>
  )
}

function MenuRows({ checkPosition, items, onClick, parentPath, subContentClassName }: RowsProps) {
  return (
    <>
      {items.map((item, index) => {
        const id = item.key ?? String(index)

        if (item.type === 'separator') {
          return <DropdownMenuSeparator className={item.className} key={id} />
        }

        const path = [...parentPath, id]

        if (item.children) {
          return (
            <DropdownMenuSub key={id}>
              <DropdownMenuSubTrigger
                className={cn('cursor-pointer', item.className)}
                disabled={item.disabled}
              >
                {item.icon}
                {item.label}
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent
                  alignOffset={item.alignOffset}
                  className={cn('flex flex-col gap-1 border-muted font-sans', subContentClassName)}
                  sideOffset={item.sideOffset}
                >
                  <MenuRows
                    checkPosition={checkPosition}
                    items={item.children}
                    onClick={onClick}
                    parentPath={path}
                    subContentClassName={subContentClassName}
                  />
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          )
        }

        const showCheck = item.checked === true
        return (
          <DropdownMenuItem
            className={cn('cursor-pointer', item.className)}
            disabled={item.disabled}
            key={id}
            onClick={(e) => {
              item.onClick?.({ e, key: id, path })
              onClick?.({ e, key: id, path })
            }}
          >
            {showCheck && checkPosition === 'left' && <CheckMark placement="left" />}
            {item.icon} {item.label}
            {showCheck && checkPosition === 'right' && <CheckMark placement="right" />}
          </DropdownMenuItem>
        )
      })}
    </>
  )
}

/**
 * A dropdown menu built from an `items` array. `children` is the trigger.
 *
 * @example
 * <DropdownMenu items={[{ key: 'edit', label: 'Edit' }]} onClick={({ key }) => edit(key)}>
 *   <button type="button">Open</button>
 * </DropdownMenu>
 */
export function DropdownMenu({
  align,
  checkPosition = 'right',
  children,
  classNames,
  ignoreInteractOutside,
  items,
  label,
  modal,
  onClick,
  onOpenChange,
  open,
  side,
  sideOffset,
  triggerDisabled,
}: DropdownMenuProps): React.ReactElement {
  return (
    <DropdownMenuRoot modal={modal} onOpenChange={onOpenChange} open={open}>
      <DropdownMenuTrigger asChild disabled={triggerDisabled}>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className={cn('border-0 font-sans', classNames?.content)}
        onInteractOutside={ignoreInteractOutside ? (e) => e.preventDefault() : undefined}
        side={side}
        sideOffset={sideOffset}
      >
        {label ? (
          <>
            <DropdownMenuLabel className={classNames?.label}>{label}</DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuGroup className="flex flex-col gap-1">
          <MenuRows
            checkPosition={checkPosition}
            items={items}
            onClick={onClick}
            parentPath={[]}
            subContentClassName={classNames?.subContent}
          />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenuRoot>
  )
}
