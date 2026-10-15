import { act, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'

import { Tabs, TabsContent, TabsList, TabsTrigger, Tooltip, TooltipProvider } from './index'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const isTooltipOpen = () => document.querySelector('[role=tooltip]') !== null

function stubMatchMedia(narrow: boolean) {
  window.matchMedia = (query: string) =>
    ({
      addEventListener: jest.fn(),
      addListener: jest.fn(),
      dispatchEvent: () => false,
      matches: narrow && query === '(max-width: 640px)',
      media: query,
      onchange: null,
      removeEventListener: jest.fn(),
      removeListener: jest.fn(),
    }) as MediaQueryList
}

beforeAll(() => {
  // Radix positioning needs ResizeObserver, which jsdom lacks.
  globalThis.ResizeObserver = jest.fn(() => ({
    disconnect: jest.fn(),
    observe: jest.fn(),
    unobserve: jest.fn(),
  })) as unknown as typeof ResizeObserver
})

beforeEach(() => stubMatchMedia(false))

describe('Tabs', () => {
  it('styles the parts, merges caller classes last and switches panels', () => {
    const onValueChange = jest.fn()
    const listRef = React.createRef<HTMLDivElement>()
    render(
      <Tabs className="root" defaultValue="a" onValueChange={onValueChange}>
        <TabsList className="h-auto p-0" ref={listRef}>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger className="px-0 data-[state=active]:shadow-none" value="b">
            B
          </TabsTrigger>
        </TabsList>
        <TabsContent className="mt-0" value="a">
          Panel A
        </TabsContent>
        <TabsContent value="b">Panel B</TabsContent>
      </Tabs>,
    )

    const list = screen.getByRole('tablist')
    expect(listRef.current).toBe(list)
    expect(list.className).toContain('bg-muted')
    expect(list.className).toContain('h-auto')
    expect(list.className).not.toContain('h-9')
    expect(list.className).not.toContain('p-1')

    const [tabA, tabB] = screen.getAllByRole('tab')
    expect(tabA.className).toContain('data-[state=active]:shadow')
    expect(tabA.className).toContain('px-3')
    expect(tabB.className).toContain('px-0')
    expect(tabB.className).not.toContain('px-3')
    expect(tabB.className).toContain('data-[state=active]:shadow-none')
    expect(tabA.getAttribute('data-state')).toBe('active')

    const panel = screen.getByRole('tabpanel')
    expect(panel.textContent).toBe('Panel A')
    expect(panel.className).toContain('mt-0')
    expect(panel.className).not.toContain('mt-2')

    // Radix tabs activate on mouse down.
    fireEvent.mouseDown(tabB, { button: 0 })
    expect(onValueChange).toHaveBeenCalledWith('b')
    expect(screen.getByRole('tabpanel').textContent).toBe('Panel B')
  })
})

describe('Tooltip', () => {
  it('renders only the child when there is no content', () => {
    const { container } = render(
      <Tooltip content={null} open>
        <button type="button">t</button>
      </Tooltip>,
    )
    expect(container.innerHTML).toBe('<button type="button">t</button>')
  })

  it('renders the hint next to the trigger, with the caller classes and an arrow', () => {
    const { container } = render(
      <Tooltip
        arrow
        arrowClassName="h-1.5 w-3 fill-[#444444]"
        className="bg-overlay"
        content="Copy"
        open
      >
        <button type="button">t</button>
      </Tooltip>,
    )
    const box = container.querySelector('[data-side]') as HTMLElement
    expect(box).not.toBeNull()
    expect(box.className).toContain('bg-overlay')
    expect(box.className).not.toContain('bg-primary')
    expect(box.className).toContain('overflow-visible')
    expect(box.className).not.toContain('overflow-hidden')
    const arrowSvg = box.querySelector('svg') as SVGElement
    expect(arrowSvg.getAttribute('class')).toContain('fill-[#444444]')
    expect(arrowSvg.getAttribute('class')).not.toContain('fill-primary')
    expect(screen.getByRole('tooltip').textContent).toBe('Copy')
  })

  it('renders into a portal when asked', () => {
    const { container } = render(
      <TooltipProvider>
        <Tooltip content="Copy" open portal>
          <button type="button">t</button>
        </Tooltip>
      </TooltipProvider>,
    )
    expect(container.querySelector('[data-side]')).toBeNull()
    expect(document.body.querySelector('[data-side]')).not.toBeNull()
  })

  it('opens on hover after 100ms and stays open when the trigger is clicked', async () => {
    const onClick = jest.fn()
    render(
      <Tooltip content="Copy" onClick={onClick}>
        <button type="button">t</button>
      </Tooltip>,
    )
    const button = screen.getByRole('button')
    await act(async () => {
      fireEvent.pointerMove(button, { pointerType: 'mouse' })
      await sleep(40)
    })
    expect(isTooltipOpen()).toBe(false)
    await act(async () => sleep(120))
    expect(isTooltipOpen()).toBe(true)

    await act(async () => {
      fireEvent.click(button)
      await sleep(10)
    })
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(isTooltipOpen()).toBe(true)
  })

  it('closes on click with disablePersistedActivation', async () => {
    render(
      <Tooltip content="Copy" delayDuration={0} disablePersistedActivation>
        <button type="button">t</button>
      </Tooltip>,
    )
    const button = screen.getByRole('button')
    await act(async () => {
      fireEvent.pointerMove(button, { pointerType: 'mouse' })
      await sleep(10)
    })
    expect(isTooltipOpen()).toBe(true)
    await act(async () => {
      fireEvent.click(button)
      await sleep(10)
    })
    expect(isTooltipOpen()).toBe(false)
  })

  it('toggles on click and closes on an outside press in click mode', async () => {
    const onOpenChange = jest.fn()
    render(
      <Tooltip content="Copy" delayDuration={0} onOpenChange={onOpenChange} trigger="click">
        <button type="button">t</button>
      </Tooltip>,
    )
    const button = screen.getByRole('button')
    await act(async () => {
      fireEvent.pointerMove(button, { pointerType: 'mouse' })
      await sleep(10)
    })
    expect(isTooltipOpen()).toBe(false)

    await act(async () => {
      fireEvent.click(button)
      await sleep(10)
    })
    expect(isTooltipOpen()).toBe(true)
    expect(onOpenChange).toHaveBeenLastCalledWith(true)

    await act(async () => {
      fireEvent.pointerDown(document.body)
      await sleep(10)
    })
    expect(isTooltipOpen()).toBe(false)
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
  })

  it('opens on click by default on narrow screens', async () => {
    stubMatchMedia(true)
    render(
      <Tooltip content="Copy" delayDuration={0}>
        <button type="button">t</button>
      </Tooltip>,
    )
    const button = screen.getByRole('button')
    await act(async () => {
      fireEvent.pointerMove(button, { pointerType: 'mouse' })
      await sleep(10)
    })
    expect(isTooltipOpen()).toBe(false)
    await act(async () => {
      fireEvent.click(button)
      await sleep(10)
    })
    expect(isTooltipOpen()).toBe(true)
  })

  it('disables the trigger', () => {
    render(
      <Tooltip content="Copy" disabled>
        <button type="button">t</button>
      </Tooltip>,
    )
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
  })
})
