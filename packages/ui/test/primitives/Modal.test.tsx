import { afterEach, describe, expect, it } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { createRef, type ReactNode, useState } from 'react'
import { Button, Menu, Modal, type ModalProps } from '../../src/index'
import { html, useDom, window } from '../dom'

useDom()

const undo: (() => void)[] = []
afterEach(() => {
  for (const restore of undo.splice(0)) restore()
})

/** Every time the modal asked to close. */
let closes = 0

interface HarnessProps extends Partial<Omit<ModalProps, 'open' | 'onClose'>> {
  initiallyOpen?: boolean
  children?: ReactNode
}

/** An opener button and a modal it opens; the modal's onClose closes it. */
function Harness({ initiallyOpen = true, children, ...props }: HarnessProps) {
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      <Modal
        title="delete bot"
        {...props}
        open={open}
        onClose={() => {
          closes++
          setOpen(false)
        }}
      >
        {children}
      </Modal>
    </>
  )
}

function renderModal(props: HarnessProps = {}) {
  closes = 0
  return render(
    <Harness
      actions={
        <>
          <Button variant="ghost">cancel</Button>
          <Button variant="danger">delete</Button>
        </>
      }
      {...props}
    >
      {props.children ?? <p>delete dwarf-v3 and its 12 versions?</p>}
    </Harness>,
  )
}

const dialog = () => screen.queryByRole('dialog')
const button = (name: string) => screen.getByRole('button', { name })
const focused = () => document.activeElement?.textContent

/** Presses `key` on whatever has focus; true when a handler took it (prevented its default). */
function press(key: string, init: KeyboardEventInit = {}): boolean {
  return !fireEvent.keyDown(document.activeElement as HTMLElement, { key, ...init })
}

describe('Modal', () => {
  it('draws the title row, the body, and the actions in a panel over the overlay', () => {
    const { container } = renderModal()
    expect(html(container)).toMatchSnapshot()
  })

  it('draws nothing while closed, and mounts its content when it opens', () => {
    renderModal({ initiallyOpen: false })
    expect(dialog()).toBeNull()
    expect(screen.queryByText('delete dwarf-v3 and its 12 versions?')).toBeNull()
    fireEvent.click(button('open'))
    expect(dialog()).not.toBeNull()
  })

  it('is a modal dialog (aria-modal) named by its title, a level-2 heading', () => {
    renderModal()
    const modal = screen.getByRole('dialog', { name: 'delete bot' })
    expect(modal.tagName).toBe('DIALOG')
    expect(modal.getAttribute('aria-modal')).toBe('true')
    expect(modal.hasAttribute('open')).toBe(true)
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('delete bot')
  })

  it('is a --panel box, --border-strong, radius 6, over a rgba(0,0,0,0.7) overlay (DESIGN_SYSTEM §4)', () => {
    renderModal()
    const modal = dialog() as HTMLElement
    expect(modal.className.split(' ')).toEqual(
      expect.arrayContaining([
        'fixed',
        'inset-0',
        'z-modal',
        'size-full',
        'bg-[rgba(0,0,0,0.7)]',
        'backdrop:bg-transparent',
        'overscroll-contain',
      ]),
    )
    const panel = modal.firstElementChild as HTMLElement
    expect(panel.className.split(' ')).toEqual(
      expect.arrayContaining([
        'bg-panel',
        'border',
        'border-border-strong',
        'rounded-lg',
        'm-auto',
      ]),
    )
    expect(screen.getByRole('heading').className).toContain('text-modal-title')
  })

  it('opens on the first control of its content', () => {
    renderModal({ children: <input aria-label="reason" /> })
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'reason' }))
  })

  it('opens on the first action when the body has no control: the least destructive goes first', () => {
    renderModal()
    expect(focused()).toBe('cancel')
  })

  it('opens on the control the content marks autoFocus', () => {
    renderModal({
      actions: (
        <>
          <Button variant="ghost">cancel</Button>
          <Button autoFocus>keep</Button>
        </>
      ),
    })
    expect(focused()).toBe('keep')
  })

  it('opens on the close button when there is nothing else to focus', () => {
    renderModal({ actions: undefined })
    expect(document.activeElement).toBe(button('close'))
  })

  it('keeps Tab inside: past the last control is the first, and Shift+Tab goes back round', () => {
    renderModal({ children: <input aria-label="reason" /> })
    // close, reason, cancel, delete
    button('delete').focus()
    expect(press('Tab')).toBe(true)
    expect(document.activeElement).toBe(button('close'))
    expect(press('Tab', { shiftKey: true })).toBe(true)
    expect(focused()).toBe('delete')
    // Between the ends the browser moves the focus: the modal leaves the key alone.
    button('cancel').focus()
    expect(press('Tab')).toBe(false)
    expect(press('Tab', { shiftKey: true })).toBe(false)
  })

  it('sends Tab from the panel itself, which is no stop, to the first or last control', () => {
    renderModal()
    const panel = (dialog() as HTMLElement).firstElementChild as HTMLElement
    panel.tabIndex = -1
    panel.focus()
    expect(press('Tab')).toBe(true)
    expect(document.activeElement).toBe(button('close'))
    panel.focus()
    expect(press('Tab', { shiftKey: true })).toBe(true)
    expect(focused()).toBe('delete')
  })

  it('closes on Escape, and the key goes no further', () => {
    renderModal()
    let heard = 0
    const listener = () => heard++
    document.addEventListener('keydown', listener)
    undo.push(() => document.removeEventListener('keydown', listener))
    expect(press('Escape')).toBe(true)
    expect(closes).toBe(1)
    expect(dialog()).toBeNull()
    expect(heard).toBe(0)
  })

  it('leaves Escape to an open menu inside it: the menu closes, the modal stays', () => {
    renderModal({
      children: (
        <Menu trigger={<Button>templates</Button>} items={[{ label: 'blank', onSelect() {} }]} />
      ),
    })
    fireEvent.click(button('templates'))
    expect(screen.getByRole('menu')).not.toBeNull()
    press('Escape')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(dialog()).not.toBeNull()
    expect(closes).toBe(0)
  })

  it('closes on a press on the overlay', () => {
    renderModal()
    const overlay = dialog() as HTMLElement
    fireEvent.pointerDown(overlay)
    fireEvent.click(overlay)
    expect(closes).toBe(1)
  })

  it('stays open for a press on the panel, and for a drag from the panel out to the overlay', () => {
    renderModal()
    const overlay = dialog() as HTMLElement
    const text = screen.getByText('delete dwarf-v3 and its 12 versions?')
    fireEvent.pointerDown(text)
    fireEvent.click(text)
    // A text selection that ends outside: the click lands on the overlay, the press did not.
    fireEvent.pointerDown(text)
    fireEvent.click(overlay)
    expect(closes).toBe(0)
    expect(dialog()).not.toBeNull()
  })

  it('closes from its close button', () => {
    renderModal()
    fireEvent.click(button('close'))
    expect(closes).toBe(1)
  })

  it('closes on the browser’s other close requests, and keeps the state the caller’s', () => {
    renderModal()
    const cancel = new window.Event('cancel', { cancelable: true })
    fireEvent(dialog() as HTMLElement, cancel)
    expect(cancel.defaultPrevented).toBe(true)
    expect(closes).toBe(1)
  })

  it('gives the focus back to what had it when it opened', () => {
    renderModal({ initiallyOpen: false })
    button('open').focus()
    fireEvent.click(button('open'))
    expect(focused()).toBe('cancel')
    press('Escape')
    expect(document.activeElement).toBe(button('open'))
  })

  it('takes the browser’s top layer when it can: showModal() on open, close() when it goes', () => {
    const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>
    const calls: string[] = []
    proto.showModal = function (this: HTMLDialogElement) {
      calls.push('showModal')
      this.setAttribute('open', '')
    }
    proto.close = function (this: HTMLDialogElement) {
      calls.push('close')
      this.removeAttribute('open')
    }
    undo.push(() => {
      delete proto.showModal
      delete proto.close
    })
    renderModal()
    expect(calls).toEqual(['showModal'])
    expect(focused()).toBe('cancel')
    press('Escape')
    expect(calls).toEqual(['showModal', 'close'])
  })

  it('widens by size: 360, 480, and 640 px', () => {
    for (const [size, width] of [
      ['sm', 'max-w-90'],
      ['md', 'max-w-120'],
      ['lg', 'max-w-160'],
    ] as const) {
      const { unmount } = renderModal({ size })
      const panel = (dialog() as HTMLElement).firstElementChild as HTMLElement
      expect({ size, width: panel.className.split(' ').includes(width) }).toEqual({
        size,
        width: true,
      })
      unmount()
    }
  })

  it('puts className on the panel, and the other props and the ref on the dialog', () => {
    const ref = createRef<HTMLDialogElement>()
    render(
      <Modal
        open
        onClose={() => {}}
        title="versions"
        ref={ref}
        id="versions"
        data-state="open"
        className="h-96"
      >
        v1
      </Modal>,
    )
    const modal = screen.getByRole('dialog', { name: 'versions' })
    expect(ref.current).toBe(modal)
    expect(modal.id).toBe('versions')
    expect(modal.dataset.state).toBe('open')
    expect((modal.firstElementChild as HTMLElement).className.endsWith(' h-96')).toBe(true)
    expect(modal.className).not.toContain('h-96')
  })

  it('draws no footer without actions', () => {
    renderModal({ actions: null })
    expect((dialog() as HTMLElement).querySelector('footer')).toBeNull()
  })
})
