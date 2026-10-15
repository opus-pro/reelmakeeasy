import { act, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'

import {
  Badge,
  Button,
  cn,
  ExternalImage,
  Input,
  Separator,
  Textarea,
  TransparentImage,
} from './index'

function classesOf(element: Element | null): string[] {
  return (element?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).sort()
}

describe('Button', () => {
  it('renders the default look as a plain <button> without a type', () => {
    render(<Button>Go</Button>)
    const button = screen.getByRole('button', { name: 'Go' })
    expect(button.getAttribute('type')).toBeNull()
    expect(classesOf(button)).toEqual(
      expect.arrayContaining(['bg-[#ffffff1a]', 'h-9', 'p-2', 'rounded-sm', 'text-primary']),
    )
  })

  it('lets the base variant undo the size padding and height', () => {
    render(
      <Button size="sm" variant="base">
        Go
      </Button>,
    )
    const classes = classesOf(screen.getByRole('button'))
    expect(classes).toEqual(expect.arrayContaining(['bg-transparent', 'h-auto', 'p-0', 'text-xs']))
    expect(classes).not.toContain('h-8')
    expect(classes).not.toContain('px-2')
  })

  it('lets className win over the variant', () => {
    render(
      <Button className="bg-transparent text-white" variant="primary">
        Go
      </Button>,
    )
    const classes = classesOf(screen.getByRole('button'))
    expect(classes).toEqual(expect.arrayContaining(['bg-transparent', 'text-white']))
    expect(classes).not.toContain('bg-primary')
    expect(classes).not.toContain('text-primary-foreground')
  })

  it('shows a spinner and ignores clicks while loading', () => {
    const onClick = jest.fn()
    const { container } = render(
      <Button loading onClick={onClick}>
        Go
      </Button>,
    )
    expect(container.querySelector('svg.animate-spin')).not.toBeNull()
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('spins while the click promise is pending with autoLoading', async () => {
    let resolve: () => void = () => undefined
    const onClick = jest.fn(() => new Promise<void>((r) => (resolve = r)))
    const { container } = render(
      <Button autoLoading onClick={onClick}>
        Go
      </Button>,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })
    expect(container.querySelector('svg.animate-spin')).not.toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })
    expect(onClick).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolve()
      await Promise.resolve()
    })
    expect(container.querySelector('svg.animate-spin')).toBeNull()
  })

  it('does not spin for a promise without autoLoading', () => {
    const { container } = render(<Button onClick={() => new Promise(() => undefined)}>Go</Button>)
    fireEvent.click(screen.getByRole('button'))
    expect(container.querySelector('svg')).toBeNull()
  })

  it('forwards the ref and renders its child with asChild', () => {
    const ref = React.createRef<HTMLButtonElement>()
    render(<Button ref={ref}>Go</Button>)
    expect(ref.current?.tagName).toBe('BUTTON')
    const { container } = render(
      <Button asChild variant="primary">
        <a href="/x">Link</a>
      </Button>,
    )
    const link = container.querySelector('a')
    expect(classesOf(link)).toContain('bg-primary')
  })
})

describe('Badge', () => {
  it('uses the default variant when none is given', () => {
    render(<Badge data-status-kind="k">B</Badge>)
    const badge = screen.getByText('B')
    expect(badge.tagName).toBe('DIV')
    expect(badge.getAttribute('data-status-kind')).toBe('k')
    expect(classesOf(badge)).toEqual(expect.arrayContaining(['bg-primary', 'rounded-md']))
  })

  it('renders the warning variant', () => {
    render(<Badge variant="warning">W</Badge>)
    expect(classesOf(screen.getByText('W'))).toEqual(
      expect.arrayContaining(['bg-warn/15', 'text-warn']),
    )
  })
})

describe('Input', () => {
  it('reports the text, styles the box and adds the focus classes while focused', () => {
    const onChange = jest.fn()
    const ref = React.createRef<HTMLInputElement>()
    const { container } = render(
      <Input
        className="h-12"
        classNames={{ focusClassName: 'ring-2', input: 'inp' }}
        onChange={onChange}
        prefix={<i>P</i>}
        ref={ref}
        suffix={<b>S</b>}
        wrapperStyle={{ width: 9 }}
      />,
    )
    const box = container.firstElementChild as HTMLElement
    const input = container.querySelector('input') as HTMLInputElement
    expect(ref.current).toBe(input)
    expect(box.style.width).toBe('9px')
    expect(Array.from(box.children).map((child) => child.tagName)).toEqual(['I', 'INPUT', 'B'])
    expect(classesOf(box)).toContain('h-12')
    expect(classesOf(box)).not.toContain('h-9')
    expect(classesOf(input)).toContain('inp')

    fireEvent.focus(input)
    expect(classesOf(box)).toEqual(expect.arrayContaining(['ring-2', 'focus-visible:ring-1']))
    fireEvent.change(input, { target: { value: 'abc' } })
    expect(onChange).toHaveBeenCalledWith('abc')
    fireEvent.blur(input)
    expect(classesOf(box)).not.toContain('ring-2')
  })
})

describe('Textarea', () => {
  it('reports the text and forwards the ref', () => {
    const onChange = jest.fn()
    const ref = React.createRef<HTMLTextAreaElement>()
    render(<Textarea className="min-h-[220px]" onChange={onChange} placeholder="p" ref={ref} />)
    const textarea = screen.getByPlaceholderText('p')
    expect(ref.current).toBe(textarea)
    expect(classesOf(textarea)).toContain('min-h-[220px]')
    expect(classesOf(textarea)).not.toContain('min-h-[60px]')
    fireEvent.change(textarea, { target: { value: 'xyz' } })
    expect(onChange).toHaveBeenCalledWith('xyz')
  })
})

describe('Separator', () => {
  it('is decorative and horizontal by default', () => {
    const { container } = render(<Separator />)
    const line = container.firstElementChild
    expect(line?.getAttribute('role')).toBe('none')
    expect(classesOf(line)).toEqual(expect.arrayContaining(['h-[1px]', 'w-full']))
  })

  it('can be vertical and exposed to screen readers', () => {
    const { container } = render(<Separator decorative={false} orientation="vertical" />)
    const line = container.firstElementChild
    expect(line?.getAttribute('role')).toBe('separator')
    expect(line?.getAttribute('data-orientation')).toBe('vertical')
    expect(classesOf(line)).toEqual(expect.arrayContaining(['h-full', 'w-[1px]']))
  })
})

describe('images', () => {
  it('loads external images anonymously without a referrer unless told otherwise', () => {
    const { container } = render(
      <>
        <ExternalImage alt="a" src="https://x/a.png" />
        <ExternalImage alt="b" crossOrigin="use-credentials" src="https://x/b.png" />
      </>,
    )
    const [a, b] = Array.from(container.querySelectorAll('img'))
    expect(a.getAttribute('crossorigin')).toBe('anonymous')
    expect(a.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(b.getAttribute('crossorigin')).toBe('use-credentials')
  })

  it('draws a checkerboard behind transparent images and keeps the caller style on top', () => {
    const { container } = render(
      <TransparentImage alt="t" src="https://x/t.png" style={{ backgroundColor: 'red' }} />,
    )
    const img = container.querySelector('img') as HTMLImageElement
    expect(img.style.backgroundSize).toBe('14px 14px')
    expect(img.style.backgroundImage).toContain('linear-gradient')
    expect(img.style.backgroundColor).toBe('red')
    expect(img.getAttribute('crossorigin')).toBeNull()
  })
})

describe('cn', () => {
  it('keeps the last of two conflicting classes', () => {
    expect(cn('h-9 p-2', 'h-7')).toBe('p-2 h-7')
  })
})
