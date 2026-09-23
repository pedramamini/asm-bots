import { describe, expect, it } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { createRef, useState } from 'react'
import { Toggle } from '../../src/index'
import { html, useDom } from '../dom'

useDom()

const toggle = () => screen.getByRole('button')
const led = () => toggle().firstElementChild as HTMLElement
const classes = (element: Element) => element.className.split(' ')

describe('Toggle', () => {
  it('draws off and on', () => {
    const { container } = render(
      <>
        <Toggle>alpr</Toggle>
        <Toggle defaultPressed>bloom</Toggle>
      </>,
    )
    expect(html(container)).toMatchSnapshot()
  })

  it('is a toggle button: aria-pressed flips on each click', () => {
    const changes: boolean[] = []
    render(<Toggle onPressedChange={(pressed) => changes.push(pressed)}>bloom</Toggle>)
    expect(screen.getByRole('button', { name: 'bloom', pressed: false })).toBe(toggle())
    fireEvent.click(toggle())
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(toggle())
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
    expect(changes).toEqual([true, false])
    expect(toggle().getAttribute('type')).toBe('button')
  })

  it('is a muted UPPER label in a hairline off, and the accent nav look on', () => {
    render(<Toggle>alpr</Toggle>)
    expect(classes(toggle())).toEqual(
      expect.arrayContaining([
        'h-6',
        'rounded-sm',
        'border',
        'text-nav',
        'border-border',
        'text-muted',
      ]),
    )
    fireEvent.click(toggle())
    expect(classes(toggle())).toEqual(
      expect.arrayContaining(['border-accent', 'bg-accent-10', 'text-accent']),
    )
  })

  it('fills its square when on, so the state reads without color', () => {
    render(<Toggle>alpr</Toggle>)
    expect(led().getAttribute('aria-hidden')).toBe('true')
    expect(classes(led())).toEqual(['size-1.5', 'border', 'border-current'])
    fireEvent.click(toggle())
    expect(classes(led())).toContain('bg-current')
  })

  it('follows a controlled state and reports the click', () => {
    const changes: boolean[] = []
    function Controlled() {
      const [on, setOn] = useState(true)
      return (
        <Toggle
          pressed={on}
          onPressedChange={(next) => {
            changes.push(next)
            setOn(next)
          }}
        >
          sound
        </Toggle>
      )
    }
    render(<Controlled />)
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(toggle())
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
    expect(changes).toEqual([false])
  })

  it('stays put when the caller does not take a controlled change', () => {
    render(<Toggle pressed={false}>sound</Toggle>)
    fireEvent.click(toggle())
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
  })

  it('calls its own onClick first, and a prevented click does not flip it', () => {
    const calls: string[] = []
    render(
      <Toggle
        onClick={(event) => {
          calls.push('click')
          event.preventDefault()
        }}
      >
        bloom
      </Toggle>,
    )
    fireEvent.click(toggle())
    expect(calls).toEqual(['click'])
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
  })

  it('passes className, attributes, and ref through', () => {
    const ref = createRef<HTMLButtonElement>()
    render(
      <Toggle ref={ref} className="ml-auto" disabled>
        alpr
      </Toggle>,
    )
    expect(ref.current).toBe(toggle() as HTMLButtonElement)
    expect(toggle().className.endsWith(' ml-auto')).toBe(true)
    expect((toggle() as HTMLButtonElement).disabled).toBe(true)
  })
})
