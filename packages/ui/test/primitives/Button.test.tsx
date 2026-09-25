import { describe, expect, it } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { Play } from 'lucide-react'
import { createRef } from 'react'
import { Button } from '../../src/index'
import { html, useDom } from '../dom'

useDom()

const button = (name: string) => screen.getByRole('button', { name })
const classes = (element: Element) => element.className.split(' ')

describe('Button', () => {
  it('draws each variant', () => {
    const { container } = render(
      <>
        <Button>refresh</Button>
        <Button variant="primary" icon={Play}>
          fight
        </Button>
        <Button variant="ghost" size="sm">
          clear
        </Button>
        <Button variant="danger">delete</Button>
        <Button loading>submit</Button>
      </>,
    )
    expect(html(container)).toMatchSnapshot()
  })

  it('is type="button" unless told otherwise, so it never submits by accident', () => {
    const submits: string[] = []
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submits.push('submit')
        }}
      >
        <Button>refresh</Button>
        <Button type="submit">save</Button>
      </form>,
    )
    expect(button('refresh').getAttribute('type')).toBe('button')
    fireEvent.click(button('refresh'))
    expect(submits).toEqual([])
    fireEvent.click(button('save'))
    expect(submits).toEqual(['submit'])
  })

  it('is 24 px at md and 20 px at sm, a bordered box in UPPER nav type (DESIGN_SYSTEM §3, §4)', () => {
    render(
      <>
        <Button>refresh</Button>
        <Button size="sm">more</Button>
      </>,
    )
    expect(classes(button('refresh'))).toEqual(
      expect.arrayContaining(['h-6', 'px-2.5', 'rounded-sm', 'border', 'text-nav']),
    )
    expect(classes(button('more'))).toEqual(expect.arrayContaining(['h-5', 'px-2']))
  })

  it('draws default as a muted hairline, primary in accent, ghost bare, danger in --danger', () => {
    render(
      <>
        <Button>refresh</Button>
        <Button variant="primary">fight</Button>
        <Button variant="ghost">clear</Button>
        <Button variant="danger">delete</Button>
      </>,
    )
    expect(classes(button('refresh'))).toEqual(
      expect.arrayContaining([
        'border-border',
        'text-muted',
        'not-disabled:hover:border-border-strong',
      ]),
    )
    expect(classes(button('fight'))).toEqual(
      expect.arrayContaining(['border-accent', 'bg-accent-10', 'text-accent-fg', 'text-nav']),
    )
    // A ghost button is a calm lowercase control, as the reference's `clear`.
    expect(classes(button('clear'))).toEqual(
      expect.arrayContaining(['border-transparent', 'text-data', 'text-muted']),
    )
    expect(classes(button('clear'))).not.toContain('text-nav')
    expect(classes(button('delete'))).toEqual(
      expect.arrayContaining(['border-danger', 'text-danger', 'not-disabled:hover:bg-danger/10']),
    )
  })

  it('draws a 12 px icon before the label', () => {
    render(
      <Button variant="primary" icon={Play}>
        fight
      </Button>,
    )
    const icon = button('fight').querySelector('svg') as SVGElement
    expect(icon.getAttribute('width')).toBe('12')
    expect(icon.getAttribute('aria-hidden')).toBe('true')
    expect(button('fight').textContent).toBe('fight')
  })

  it('shows three pulsing dots while loading, keeps its name and focus, and takes no click', () => {
    const calls: string[] = []
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault()
          calls.push('submit')
        }}
      >
        <Button type="submit" loading onClick={() => calls.push('click')}>
          fight
        </Button>
      </form>,
    )
    const busy = button('fight') as HTMLButtonElement
    expect(busy.getAttribute('aria-busy')).toBe('true')
    expect(busy.getAttribute('aria-disabled')).toBe('true')
    expect(busy.disabled).toBe(false)
    const dots = [...busy.querySelectorAll('.animate-dot-pulse')]
    expect(dots).toHaveLength(3)
    expect(dots[0]?.parentElement?.getAttribute('aria-hidden')).toBe('true')
    expect(
      dots.map((dot) => classes(dot).find((name) => name.startsWith('[animation-delay'))),
    ).toEqual([undefined, '[animation-delay:160ms]', '[animation-delay:320ms]'])
    // Reduced motion: the dots hold still.
    expect(dots.every((dot) => classes(dot).includes('motion-reduce:animate-none'))).toBe(true)
    // The label keeps the button's width, unseen.
    expect(classes(busy.firstElementChild as Element)).toContain('opacity-0')
    fireEvent.click(busy)
    expect(calls).toEqual([])
  })

  it('works again when loading ends', () => {
    const clicks: string[] = []
    const { rerender } = render(
      <Button loading onClick={() => clicks.push('click')}>
        fight
      </Button>,
    )
    rerender(<Button onClick={() => clicks.push('click')}>fight</Button>)
    expect(button('fight').getAttribute('aria-busy')).toBeNull()
    expect(button('fight').querySelector('.animate-dot-pulse')).toBeNull()
    fireEvent.click(button('fight'))
    expect(clicks).toEqual(['click'])
  })

  it('fades when disabled and shows the focus ring on keyboard focus', () => {
    render(<Button disabled>refresh</Button>)
    expect((button('refresh') as HTMLButtonElement).disabled).toBe(true)
    expect(classes(button('refresh'))).toEqual(
      expect.arrayContaining([
        'disabled:opacity-40',
        'disabled:cursor-not-allowed',
        'focus-visible:outline-1',
        'focus-visible:outline-offset-1',
        'focus-visible:outline-accent',
      ]),
    )
  })

  it('passes className, attributes, and ref through', () => {
    const ref = createRef<HTMLButtonElement>()
    render(
      <Button ref={ref} className="ml-auto" id="refresh" aria-keyshortcuts="R">
        refresh
      </Button>,
    )
    expect(ref.current).toBe(button('refresh') as HTMLButtonElement)
    expect(button('refresh').className.endsWith(' ml-auto')).toBe(true)
    expect(button('refresh').id).toBe('refresh')
    expect(button('refresh').getAttribute('aria-keyshortcuts')).toBe('R')
  })
})
