import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'

import { Modal } from './index'

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
  })

const buttonByText = (text: string) =>
  Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent === text,
  ) as HTMLButtonElement

afterEach(async () => {
  cleanup()
  await flush()
  document.body.innerHTML = ''
})

describe('Modal', () => {
  it('renders title, description, body, footer buttons and the close button', () => {
    render(
      <Modal
        cancelText="Cancel"
        classNames={{ content: 'dialog-content', overlay: 'dialog-overlay' }}
        confirmButtonProps={{ className: 'bg-primary text-primary-foreground', disabled: true }}
        confirmText="OK"
        description="desc"
        open
        title="Title"
      >
        body
      </Modal>,
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('dialog-content')
    expect(document.querySelector('.dialog-overlay')).not.toBeNull()
    expect(screen.getByText('Title').tagName).toBe('H2')
    expect(screen.getByText('desc').tagName).toBe('P')
    expect(dialog.textContent).toContain('body')

    const confirm = buttonByText('OK')
    expect(confirm.type).toBe('submit')
    expect(confirm.disabled).toBe(true)
    // tailwind-merge lets the caller's colors replace the defaults
    expect(confirm.className).toContain('bg-primary')
    expect(confirm.className).not.toContain('bg-[#ffffff1a]')
    expect(buttonByText('Cancel')).toBeDefined()
    expect(screen.getByText('Close').className).toBe('sr-only')
  })

  it('keeps an accessible name when there is no visible header, and omits the footer and close button', () => {
    render(<Modal footer={null} header={null} open showClose={false} />)

    const dialog = screen.getByRole('dialog')
    expect(screen.getByText('Dialog').tagName).toBe('H2')
    expect(dialog.querySelectorAll('button')).toHaveLength(0)
  })

  it('wires the buttons, close button and overlay to onCancel / onConfirm / onOpenChange', async () => {
    const log: string[] = []
    function Controlled() {
      const [open, setOpen] = React.useState(true)
      return (
        <Modal
          cancelText="C"
          confirmText="OK"
          onCancel={() => log.push('cancel')}
          onConfirm={() => log.push('confirm')}
          onOpenChange={(next) => {
            log.push(`openChange(${next})`)
            setOpen(next)
          }}
          open={open}
          title="T"
        />
      )
    }
    render(<Controlled />)

    fireEvent.click(buttonByText('C'))
    fireEvent.click(buttonByText('OK'))
    expect(log).toEqual(['cancel', 'confirm'])

    fireEvent.click(screen.getByText('Close').parentElement as HTMLElement)
    await flush()
    expect(log).toEqual(['cancel', 'confirm', 'cancel', 'openChange(false)'])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('ignores outside pointer-downs when ignoreInteractOutside is set', async () => {
    const onOpenChange = jest.fn()
    render(<Modal ignoreInteractOutside onOpenChange={onOpenChange} open title="T" />)
    await flush()

    fireEvent.pointerDown(document.body)
    await flush()
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})

describe('Modal.alert', () => {
  it('renders an alert dialog and closes after confirm', async () => {
    const onConfirm = jest.fn()
    act(() => {
      Modal.alert({
        cancelText: 'C',
        classNames: { title: 'text-[#FAFAFA]' },
        confirmText: 'OK',
        description: 'D',
        onConfirm,
        title: 'T',
      })
    })
    await flush()

    const dialog = screen.getByRole('alertdialog')
    expect(screen.getByText('T').className).toContain('text-[#FAFAFA]')
    expect(dialog.textContent).toContain('D')

    fireEvent.click(buttonByText('OK'))
    await flush()
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('calls onClose (not onCancel) from the close button', async () => {
    const onCancel = jest.fn()
    const onClose = jest.fn()
    act(() => {
      Modal.alert({ closeIcon: <i>x</i>, onCancel, onClose, title: 'T' })
    })
    await flush()

    fireEvent.click(screen.getByText('x').closest('button') as HTMLElement)
    await flush()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('updates and destroys through the handle', async () => {
    let handle: ReturnType<typeof Modal.alert> | undefined
    act(() => {
      handle = Modal.alert({ description: 'D', title: 'T' })
    })
    await flush()

    act(() => handle?.update({ title: 'T2' }))
    await flush()
    expect(screen.getByText('T2')).toBeDefined()

    act(() => handle?.update((prev) => ({ ...prev, description: 'D3' })))
    await flush()
    expect(screen.getByText('D3')).toBeDefined()

    act(() => handle?.destroy())
    await flush()
    expect(screen.queryByRole('alertdialog')).toBeNull()

    // inert once closed
    act(() => handle?.update({ title: 'T4' }))
    await flush()
    expect(screen.queryByText('T4')).toBeNull()
  })
})
