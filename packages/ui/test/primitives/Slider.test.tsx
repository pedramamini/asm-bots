import { describe, expect, it } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { createRef, useState } from 'react'
import { Slider } from '../../src/index'
import { html, useDom } from '../dom'

useDom()

const range = () => screen.getByRole('slider') as HTMLInputElement
const fill = () => range().style.getPropertyValue('--fill')
const speed = (value: number) => `${value.toLocaleString('en-US')}/frame`

/** Presses `key` on the slider and says whether the slider took it. */
function press(key: string): boolean {
  return !fireEvent.keyDown(range(), { key })
}

/** The speed control: 1 … 10,000 cycles per frame on a log scale. */
function Speed({ start = 100 }: { start?: number }) {
  const [value, setValue] = useState(start)
  return (
    <Slider
      aria-label="speed"
      min={1}
      max={10_000}
      scale="log"
      value={value}
      onValueChange={setValue}
      format={speed}
      showValue
    />
  )
}

describe('Slider', () => {
  it('draws the track, and the log speed control with its readout', () => {
    const { container } = render(
      <>
        <Slider aria-label="volume" min={0} max={100} defaultValue={40} />
        <Speed />
      </>,
    )
    expect(html(container)).toMatchSnapshot()
  })

  it('is the native range on a linear scale', () => {
    const values: number[] = []
    render(
      <Slider
        aria-label="volume"
        min={0}
        max={100}
        step={5}
        defaultValue={40}
        onValueChange={(value) => values.push(value)}
      />,
    )
    expect([range().min, range().max, range().step, range().value]).toEqual(['0', '100', '5', '40'])
    expect(fill()).toBe('40.00%')
    fireEvent.change(range(), { target: { value: '65' } })
    expect(range().value).toBe('65')
    expect(fill()).toBe('65.00%')
    expect(values).toEqual([65])
  })

  it('starts at min without a value', () => {
    render(<Slider aria-label="volume" min={10} max={20} />)
    expect(range().value).toBe('10')
    expect(fill()).toBe('0.00%')
  })

  it('reads the formatted value to assistive tech', () => {
    render(<Speed start={2000} />)
    expect(screen.getByRole('slider', { name: 'speed' }).getAttribute('aria-valuetext')).toBe(
      '2,000/frame',
    )
  })

  it('spreads a log scale by ratio: each decade is a quarter of 1 … 10,000', () => {
    render(<Speed start={100} />)
    expect([range().min, range().max, range().step]).toEqual(['0', '1000', '1'])
    expect(range().value).toBe('500')
    expect(fill()).toBe('50.00%')
    fireEvent.change(range(), { target: { value: '750' } })
    expect(range().getAttribute('aria-valuetext')).toBe('1,000/frame')
    fireEvent.change(range(), { target: { value: '0' } })
    expect(range().getAttribute('aria-valuetext')).toBe('1/frame')
    fireEvent.change(range(), { target: { value: '1000' } })
    expect(range().getAttribute('aria-valuetext')).toBe('10,000/frame')
  })

  it('rounds a log value to its step', () => {
    render(<Speed />)
    fireEvent.change(range(), { target: { value: '333' } })
    // 10,000^0.333 is 21.4: whole cycles only.
    expect(range().getAttribute('aria-valuetext')).toBe('21/frame')
  })

  it('doubles and halves a log value with the arrow keys, ×10 with Page Up and Down', () => {
    render(<Speed start={100} />)
    const values: string[] = []
    const read = () => values.push(range().getAttribute('aria-valuetext') ?? '')
    for (const key of ['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'PageUp', 'PageDown']) {
      expect(press(key)).toBe(true)
      read()
    }
    expect(values).toEqual([
      '200/frame',
      '400/frame',
      '200/frame',
      '100/frame',
      '1,000/frame',
      '100/frame',
    ])
  })

  it('holds a log value to min..max at the keys', () => {
    render(<Speed start={8000} />)
    press('ArrowRight')
    expect(range().getAttribute('aria-valuetext')).toBe('10,000/frame')
    press('PageUp')
    expect(range().getAttribute('aria-valuetext')).toBe('10,000/frame')
    press('PageDown')
    press('PageDown')
    press('PageDown')
    press('PageDown')
    expect(range().getAttribute('aria-valuetext')).toBe('1/frame')
  })

  it('takes one grain when rounding would undo a key step', () => {
    render(<Speed start={1} />)
    press('ArrowRight')
    expect(range().getAttribute('aria-valuetext')).toBe('2/frame')
    press('ArrowLeft')
    expect(range().getAttribute('aria-valuetext')).toBe('1/frame')
    render(
      <Slider
        aria-label="zoom"
        min={1}
        max={16}
        step={4}
        scale="log"
        defaultValue={1}
        format={String}
      />,
    )
    const zoom = screen.getByRole('slider', { name: 'zoom' })
    fireEvent.keyDown(zoom, { key: 'ArrowRight' })
    expect(zoom.getAttribute('aria-valuetext')).toBe('5')
  })

  it('leaves Home and End to the browser (they reach the ends of the positions)', () => {
    render(<Speed />)
    expect(press('Home')).toBe(false)
    expect(press('End')).toBe(false)
  })

  it('leaves every key to the browser on a linear scale', () => {
    render(<Slider aria-label="volume" min={0} max={100} />)
    for (const key of ['ArrowRight', 'ArrowLeft', 'PageUp', 'PageDown', 'Home', 'End']) {
      expect({ key, taken: press(key) }).toEqual({ key, taken: false })
    }
  })

  it('needs min > 0 on a log scale', () => {
    const quiet = console.error
    console.error = () => {}
    try {
      expect(() => render(<Slider aria-label="speed" min={0} max={10} scale="log" />)).toThrow(
        'a log slider needs min > 0, not 0',
      )
    } finally {
      console.error = quiet
    }
  })

  it('shows the readout in a column as wide as the widest value, hidden from assistive tech', () => {
    render(<Speed />)
    const readout = range().nextElementSibling as HTMLElement
    expect(readout.textContent).toBe('100/frame')
    expect(readout.getAttribute('aria-hidden')).toBe('true')
    expect(readout.style.getPropertyValue('--readout')).toBe('12ch')
    expect(readout.className.split(' ')).toEqual(
      expect.arrayContaining(['min-w-(--readout)', 'text-right', 'text-data', 'text-muted']),
    )
  })

  it('draws a 2 px track filled in accent to --fill and a 6 x 12 px accent thumb', () => {
    render(<Speed />)
    expect(range().className.split(' ')).toEqual(
      expect.arrayContaining([
        'appearance-none',
        '[&::-webkit-slider-runnable-track]:h-0.5',
        '[&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,var(--accent)_var(--fill),var(--border-strong)_var(--fill))]',
        '[&::-webkit-slider-thumb]:h-3',
        '[&::-webkit-slider-thumb]:w-1.5',
        '[&::-webkit-slider-thumb]:bg-accent',
        '[&::-moz-range-progress]:bg-accent',
        '[&::-moz-range-thumb]:bg-accent',
        'focus-visible:outline-accent',
      ]),
    )
  })

  it('holds the fill to the track when a controlled value strays', () => {
    render(<Slider aria-label="volume" min={0} max={100} value={140} />)
    expect(fill()).toBe('100.00%')
  })

  it('passes className to the box, and the other props and the ref to the <input>', () => {
    const ref = createRef<HTMLInputElement>()
    const keys: string[] = []
    render(
      <Slider
        ref={ref}
        aria-label="volume"
        min={0}
        max={100}
        className="w-48"
        name="volume"
        style={{ opacity: 0.5 }}
        onKeyDown={(event) => keys.push(event.key)}
        disabled
      />,
    )
    expect(ref.current).toBe(range())
    expect((range().parentElement as HTMLElement).className.endsWith(' w-48')).toBe(true)
    expect(range().name).toBe('volume')
    expect(range().disabled).toBe(true)
    expect(range().style.opacity).toBe('0.5')
    expect(fill()).toBe('0.00%')
    fireEvent.keyDown(range(), { key: 'ArrowUp' })
    expect(keys).toEqual(['ArrowUp'])
  })
})
