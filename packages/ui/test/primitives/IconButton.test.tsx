import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { StepBack, Volume2 } from 'lucide-react'
import { createRef } from 'react'
import { IconButton } from '../../src/index'
import { html, useDom } from '../dom'

useDom()

beforeEach(() => {
  jest.useFakeTimers()
})
afterEach(() => {
  jest.useRealTimers()
})

const button = () => screen.getByRole('button')
const icon = () => button().querySelector('svg') as SVGElement

describe('IconButton', () => {
  it('draws the icon in a square button, and its tooltip on hover', () => {
    const { container } = render(<IconButton icon={StepBack} label="step back" shortcut="," />)
    fireEvent.pointerEnter(button(), { pointerType: 'mouse' })
    act(() => {
      jest.advanceTimersByTime(400)
    })
    expect(html(container)).toMatchSnapshot()
  })

  it('is named by its label, and the icon is hidden from assistive tech', () => {
    render(<IconButton icon={StepBack} label="step back" />)
    expect(screen.getByRole('button', { name: 'step back' })).toBe(button())
    expect(icon().getAttribute('aria-hidden')).toBe('true')
    expect(button().getAttribute('type')).toBe('button')
  })

  it('shows its label and shortcut in a tooltip that repeats the name, so AT skips it', () => {
    render(<IconButton icon={StepBack} label="step back" shortcut="," />)
    fireEvent.pointerEnter(button(), { pointerType: 'mouse' })
    act(() => {
      jest.advanceTimersByTime(400)
    })
    const tip = screen.getByRole('tooltip', { hidden: true })
    expect(tip.textContent).toBe('step back,')
    expect(tip.querySelector('kbd')?.textContent).toBe(',')
    expect(tip.getAttribute('aria-hidden')).toBe('true')
    expect(button().getAttribute('aria-describedby')).toBeNull()
  })

  it('is 24 px square with a 16 px icon at md, 20 px with a 12 px icon at sm (DESIGN_SYSTEM §6)', () => {
    const { unmount } = render(<IconButton icon={StepBack} label="step back" />)
    expect(button().className.split(' ')).toEqual(
      expect.arrayContaining(['size-6', 'rounded-sm', 'border', 'border-border', 'text-text']),
    )
    expect([icon().getAttribute('width'), icon().getAttribute('stroke-width')]).toEqual([
      '16',
      '1.75',
    ])
    unmount()
    render(<IconButton icon={StepBack} label="step back" size="sm" />)
    expect(button().className.split(' ')).toContain('size-5')
    expect(icon().getAttribute('width')).toBe('12')
  })

  it('reports a toggle’s state with aria-pressed, and is accent when on', () => {
    const { rerender } = render(<IconButton icon={Volume2} label="sound" pressed={false} />)
    expect(button().getAttribute('aria-pressed')).toBe('false')
    rerender(<IconButton icon={Volume2} label="sound" pressed />)
    expect(button().getAttribute('aria-pressed')).toBe('true')
    expect(button().className.split(' ')).toEqual(
      expect.arrayContaining(['border-accent', 'bg-accent-10', 'text-accent-fg']),
    )
    rerender(<IconButton icon={Volume2} label="sound" />)
    expect(button().getAttribute('aria-pressed')).toBeNull()
  })

  it('passes className, attributes, handlers, and ref through to the button', () => {
    const ref = createRef<HTMLButtonElement>()
    const clicks: string[] = []
    render(
      <IconButton
        ref={ref}
        icon={StepBack}
        label="step back"
        className="ml-auto"
        data-key=","
        onClick={() => clicks.push('click')}
      />,
    )
    expect(ref.current).toBe(button() as HTMLButtonElement)
    expect(button().className.endsWith(' ml-auto')).toBe(true)
    expect(button().dataset.key).toBe(',')
    fireEvent.click(button())
    expect(clicks).toEqual(['click'])
  })

  it('fades when disabled', () => {
    render(<IconButton icon={StepBack} label="step back" disabled />)
    expect((button() as HTMLButtonElement).disabled).toBe(true)
    expect(button().className.split(' ')).toEqual(
      expect.arrayContaining(['disabled:opacity-40', 'disabled:cursor-not-allowed']),
    )
  })
})
