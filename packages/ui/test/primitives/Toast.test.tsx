import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import {
  TOAST_DURATION,
  Toast,
  type ToastApi,
  ToastProvider,
  type ToastVariant,
  useToast,
} from '../../src/index'
import { html, useDom } from '../dom'

useDom()

beforeEach(() => {
  jest.useFakeTimers()
})
afterEach(() => {
  // Real timers again before useDom's clean-up, which waits on a real task.
  jest.useRealTimers()
})

const STRIPES: readonly (readonly [ToastVariant, string])[] = [
  ['neutral', 'border-l-border-strong'],
  ['accent', 'border-l-accent'],
  ['warn', 'border-l-warn'],
  ['danger', 'border-l-danger'],
  ['info', 'border-l-info'],
]

/** The toast functions, caught from inside a provider. */
let api: ToastApi

function Catch() {
  api = useToast()
  return null
}

function renderProvider(duration?: number) {
  return render(
    <ToastProvider {...(duration === undefined ? {} : { duration })}>
      <Catch />
      <button type="button">elsewhere</button>
    </ToastProvider>,
  )
}

const region = () => screen.getByRole('region', { name: 'notifications' })
const shown = () => [...region().querySelectorAll('li')].map((li) => li.textContent)
const wait = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms)
  })
const show = (...args: Parameters<ToastApi['toast']>) => {
  let id = 0
  act(() => {
    id = api.toast(...args)
  })
  return id
}

describe('Toast', () => {
  it('draws a toast in each variant', () => {
    const { container } = render(
      <>
        {STRIPES.map(([variant]) => (
          <Toast key={variant} variant={variant} onDismiss={() => {}}>
            {variant}
          </Toast>
        ))}
        <Toast variant="danger" action={{ label: 'retry', onClick() {} }}>
          submission failed
        </Toast>
      </>,
    )
    expect(html(container)).toMatchSnapshot()
  })

  it('is --panel with a --border-strong hairline and a 2 px stripe in the variant’s color (DESIGN_SYSTEM §4)', () => {
    render(
      STRIPES.map(([variant]) => (
        <Toast key={variant} variant={variant}>
          {variant}
        </Toast>
      )),
    )
    for (const [variant, stripe] of STRIPES) {
      const names = screen.getByText(variant).parentElement?.className.split(' ') ?? []
      expect({ variant, stripes: names.filter((name) => name.startsWith('border-l-')) }).toEqual({
        variant,
        stripes: ['border-l-2', stripe],
      })
      expect(names).toEqual(
        expect.arrayContaining(['bg-panel', 'border', 'border-border-strong', 'rounded-md']),
      )
    }
  })

  it('draws the close button only with onDismiss, and the action beside the message', () => {
    const dismissed: string[] = []
    const done: string[] = []
    render(
      <Toast
        action={{ label: 'undo', onClick: () => done.push('undo') }}
        onDismiss={() => dismissed.push('x')}
      >
        deleted imp
      </Toast>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'undo' }))
    expect(done).toEqual(['undo'])
    // The action closes the toast too.
    expect(dismissed).toEqual(['x'])
    fireEvent.click(screen.getByRole('button', { name: 'dismiss' }))
    expect(dismissed).toEqual(['x', 'x'])
  })

  it('draws no close button without onDismiss', () => {
    render(<Toast>queued</Toast>)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('passes className, attributes, and ref through', () => {
    const ref = createRef<HTMLDivElement>()
    render(
      <Toast ref={ref} className="w-96" data-id="7">
        saved
      </Toast>,
    )
    const toast = screen.getByText('saved').parentElement as HTMLElement
    expect(ref.current).toBe(toast)
    expect(toast.dataset.id).toBe('7')
    expect(toast.className.endsWith(' w-96')).toBe(true)
  })
})

describe('useToast', () => {
  it('needs a ToastProvider', () => {
    const error = console.error
    console.error = () => {}
    try {
      expect(() => render(<Catch />)).toThrow('useToast needs a <ToastProvider> above it')
    } finally {
      console.error = error
    }
  })

  it('shows toasts in a polite live region at the bottom right, newest at the bottom', () => {
    renderProvider()
    const stack = region()
    expect(stack.getAttribute('aria-live')).toBe('polite')
    expect(stack.getAttribute('aria-relevant')).toBe('additions')
    expect(stack.className.split(' ')).toEqual(
      expect.arrayContaining(['fixed', 'right-3', 'bottom-8', 'z-toast', 'pointer-events-none']),
    )
    show('link copied', { variant: 'accent' })
    show('saved dwarf-v3')
    expect(shown()).toEqual(['link copied', 'saved dwarf-v3'])
    const first = region().querySelector('li > div') as HTMLElement
    expect(first.className).toContain('border-l-accent')
  })

  it('closes a toast after 5 s', () => {
    renderProvider()
    show('link copied')
    wait(TOAST_DURATION - 1)
    expect(shown()).toEqual(['link copied'])
    wait(1)
    expect(shown()).toEqual([])
    expect(TOAST_DURATION).toBe(5000)
  })

  it('times each toast from its own start', () => {
    renderProvider()
    show('first')
    wait(3000)
    show('second')
    wait(2000)
    expect(shown()).toEqual(['second'])
    wait(3000)
    expect(shown()).toEqual([])
  })

  it('takes a duration from its options or from the provider; Infinity stays', () => {
    renderProvider(1000)
    show('short')
    show('long', { duration: 8000 })
    show('sticky', { duration: Number.POSITIVE_INFINITY })
    wait(1000)
    expect(shown()).toEqual(['long', 'sticky'])
    wait(7000)
    expect(shown()).toEqual(['sticky'])
    wait(60_000)
    expect(shown()).toEqual(['sticky'])
  })

  it('stops the clocks while the pointer is on the stack, and runs on with the time left', () => {
    renderProvider()
    show('link copied')
    wait(4000)
    fireEvent.pointerEnter(region().querySelector('li') as HTMLElement)
    wait(10_000)
    expect(shown()).toEqual(['link copied'])
    fireEvent.pointerLeave(region().querySelector('li') as HTMLElement)
    wait(999)
    expect(shown()).toEqual(['link copied'])
    wait(1)
    expect(shown()).toEqual([])
  })

  it('stops the clocks while the focus is in the stack', () => {
    renderProvider()
    show('link copied')
    wait(4000)
    act(() => screen.getByRole('button', { name: 'dismiss' }).focus())
    wait(10_000)
    expect(shown()).toEqual(['link copied'])
    act(() => screen.getByRole('button', { name: 'elsewhere' }).focus())
    wait(1000)
    expect(shown()).toEqual([])
  })

  it('closes a toast from its close button, from its action, or by id', () => {
    renderProvider()
    const done: string[] = []
    show('one')
    show('two', { action: { label: 'open', onClick: () => done.push('open') } })
    const three = show('three')
    fireEvent.click(screen.getAllByRole('button', { name: 'dismiss' })[0] as HTMLElement)
    expect(shown()).toEqual(['twoopen', 'three'])
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    expect(done).toEqual(['open'])
    expect(shown()).toEqual(['three'])
    act(() => api.dismiss(three))
    expect(shown()).toEqual([])
    // A toast already gone: nothing happens.
    act(() => api.dismiss(three))
    expect(shown()).toEqual([])
  })

  it('shows five at most: a sixth pushes out the oldest', () => {
    renderProvider()
    for (const n of [1, 2, 3, 4, 5, 6]) show(`toast ${n}`)
    expect(shown()).toEqual(['toast 2', 'toast 3', 'toast 4', 'toast 5', 'toast 6'])
  })

  it('returns a new id for each toast, and keeps toast and dismiss the same across renders', () => {
    const { rerender } = renderProvider()
    const first = api
    const a = show('a')
    const b = show('b')
    expect(b).not.toBe(a)
    rerender(
      <ToastProvider>
        <Catch />
      </ToastProvider>,
    )
    expect(api.toast).toBe(first.toast)
    expect(api.dismiss).toBe(first.dismiss)
  })
})
