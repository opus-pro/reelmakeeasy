import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  type MenuProps,
} from './index'

// Radix menus measure and observe elements; jsdom has none of these.
beforeAll(() => {
  const noop = () => undefined
  const g = globalThis as Record<string, unknown>
  g.ResizeObserver ??= class {
    disconnect = noop
    observe = noop
    unobserve = noop
  }
  const proto = Element.prototype as unknown as Record<string, unknown>
  proto.scrollIntoView ??= noop
  proto.hasPointerCapture ??= () => false
  proto.releasePointerCapture ??= noop
})

afterEach(cleanup)

const flush = () => act(() => new Promise((r) => setTimeout(r, 20)))
const row = (text: string) =>
  screen.getAllByRole('menuitem').find((el) => el.textContent?.trim() === text) as HTMLElement

describe('DropdownMenu', () => {
  it('renders only the trigger while closed', () => {
    render(
      <DropdownMenu items={[{ key: 'a', label: 'A' }]}>
        <button type="button">open</button>
      </DropdownMenu>,
    )
    const trigger = screen.getByRole('button', { name: 'open' })
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('data-state')).toBe('closed')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('disables the trigger with triggerDisabled', () => {
    render(
      <DropdownMenu items={[]} triggerDisabled>
        <button type="button">open</button>
      </DropdownMenu>,
    )
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders the label, rows, separator, disabled rows and check marks', async () => {
    const items: MenuProps[] = [
      { key: 'a', label: 'Alpha', className: 'row-a' },
      { key: 'b', label: 'Beta', checked: true },
      { key: 'c', label: 'Gamma', disabled: true, icon: <i>I</i> },
      { type: 'separator', key: 's' },
    ]
    render(
      <DropdownMenu
        classNames={{ content: 'menu-x', label: 'label-x' }}
        items={items}
        label="Pick"
        open
      >
        <button type="button">open</button>
      </DropdownMenu>,
    )
    await flush()

    const menu = screen.getByRole('menu')
    expect(menu.className).toContain('menu-x')
    expect(menu.className).toContain('border-0')
    expect(menu.className).not.toMatch(/(^|\s)border(\s|$)/)
    expect(screen.getByText('Pick').className).toContain('label-x')
    expect(menu.querySelectorAll('[role=separator]')).toHaveLength(2)

    expect(row('Alpha').className).toContain('row-a')
    expect(row('Alpha').className).toContain('cursor-pointer')
    expect(row('Alpha').querySelector('svg')).toBeNull()
    expect(row('Beta').querySelector('div.absolute.right-2 svg')).not.toBeNull()
    expect(row('I Gamma').getAttribute('data-disabled')).toBe('')
  })

  it('puts the check mark first with checkPosition="left"', async () => {
    render(
      <DropdownMenu checkPosition="left" items={[{ key: 'a', label: 'A', checked: true }]} open>
        <button type="button">open</button>
      </DropdownMenu>,
    )
    await flush()
    const first = row('A').firstElementChild as HTMLElement
    expect(first.querySelector('svg')).not.toBeNull()
    expect(first.className).not.toContain('absolute')
  })

  it('calls the row onClick, then the menu onClick, then closes', async () => {
    const calls: string[] = []
    const Menu = () => {
      const [open, setOpen] = React.useState(true)
      return (
        <DropdownMenu
          items={[
            { key: 'a', label: 'A', onClick: ({ key, path }) => calls.push(`row ${key} ${path}`) },
          ]}
          onClick={({ e, key, path }) => calls.push(`menu ${key} ${path} ${typeof e}`)}
          onOpenChange={(next) => {
            calls.push(`open ${next}`)
            setOpen(next)
          }}
          open={open}
        >
          <button type="button">open</button>
        </DropdownMenu>
      )
    }
    render(<Menu />)
    await flush()
    fireEvent.click(row('A'))
    await flush()
    expect(calls).toEqual(['row a a', 'menu a a object', 'open false'])
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('stays open on outside clicks with ignoreInteractOutside', async () => {
    const onOpenChange = jest.fn()
    render(
      <DropdownMenu
        ignoreInteractOutside
        items={[{ key: 'a', label: 'A' }]}
        onOpenChange={onOpenChange}
        open
      >
        <button type="button">open</button>
      </DropdownMenu>,
    )
    await flush()
    fireEvent.pointerDown(document.body)
    await flush()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('opens a submenu and reports the full path of a nested row', async () => {
    const onClick = jest.fn()
    render(
      <DropdownMenu
        classNames={{ subContent: 'sub-x' }}
        items={[{ key: 'd', label: 'More', children: [{ key: 'd1', label: 'Nested' }] }]}
        onClick={onClick}
        open
      >
        <button type="button">open</button>
      </DropdownMenu>,
    )
    await flush()
    fireEvent.keyDown(row('More'), { key: 'ArrowRight' })
    await flush()
    const menus = screen.getAllByRole('menu')
    expect(menus).toHaveLength(2)
    expect(menus[1].className).toContain('sub-x')
    fireEvent.click(row('Nested'))
    expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ key: 'd1', path: ['d', 'd1'] }))
  })
})

describe('dropdown parts', () => {
  it('compose into a menu and merge classes', async () => {
    const ref = React.createRef<HTMLDivElement>()
    render(
      <DropdownMenuRoot open>
        <DropdownMenuTrigger>open</DropdownMenuTrigger>
        <DropdownMenuContent className="p-3" ref={ref}>
          <DropdownMenuItem className="extra">One</DropdownMenuItem>
          <DropdownMenuItem inset>Two</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenuRoot>,
    )
    await flush()
    expect(ref.current?.getAttribute('role')).toBe('menu')
    expect(ref.current?.className).toContain('p-3')
    expect(ref.current?.className).not.toMatch(/(^|\s)p-1(\s|$)/)
    expect(row('One').className).toContain('extra')
    expect(row('Two').className).toContain('pl-8')
  })
})

describe('Tab inside an open menu', () => {
  const items: MenuProps[] = [
    { key: 'a', label: 'Auto' },
    { disabled: true, key: 'b', label: 'Unavailable' },
    { key: 'c', label: 'Whisper' },
    { key: 'd', label: 'Off' },
  ]

  it('moves through the rows, skipping disabled ones, and wraps both ways', async () => {
    render(
      <DropdownMenu items={items} open>
        <button type="button">open</button>
      </DropdownMenu>,
    )
    await flush()
    const menu = screen.getByRole('menu')
    row('Auto').focus()
    fireEvent.keyDown(menu, { key: 'Tab' })
    expect(document.activeElement).toBe(row('Whisper'))
    fireEvent.keyDown(menu, { key: 'Tab' })
    expect(document.activeElement).toBe(row('Off'))
    fireEvent.keyDown(menu, { key: 'Tab' })
    expect(document.activeElement).toBe(row('Auto'))
    fireEvent.keyDown(menu, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(row('Off'))
    expect(screen.getByRole('menu')).toBeTruthy()
  })
})
