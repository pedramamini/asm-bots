import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { Hex } from '../../src/index'
import { html, useDom } from '../dom'

useDom()

describe('Hex', () => {
  it('draws an address and a byte', () => {
    const { container } = render(
      <>
        <Hex value={0x1a2f} />
        <Hex byte value={0xff} />
      </>,
    )
    expect(html(container)).toMatchSnapshot()
  })

  it('shows an address as 0x and 4 uppercase digits, never decimal (DESIGN_SYSTEM §1.2)', () => {
    const { container } = render(
      <>
        <Hex value={0x1a2f} />
        <Hex value={0} />
        <Hex value={0x41} />
        <Hex value={0xfffe} />
      </>,
    )
    expect([...container.querySelectorAll('data')].map((d) => d.textContent)).toEqual([
      '0x1A2F',
      '0x0000',
      '0x0041',
      '0xFFFE',
    ])
  })

  it('shows a byte as 2 uppercase digits, no prefix', () => {
    const { container } = render(
      <>
        <Hex byte value={0xff} />
        <Hex byte value={7} />
      </>,
    )
    expect([...container.querySelectorAll('data')].map((d) => d.textContent)).toEqual(['FF', '07'])
  })

  it('wraps as the core does: an address to 16 bits, a byte to 8', () => {
    const { container } = render(
      <>
        <Hex value={0x1_0010} />
        <Hex value={-2} />
        <Hex byte value={0x1ff} />
      </>,
    )
    expect([...container.querySelectorAll('data')].map((d) => d.textContent)).toEqual([
      '0x0010',
      '0xFFFE',
      'FF',
    ])
  })

  it('is a <data> whose value is the number in decimal, with a faint 0x', () => {
    render(<Hex value={0x1a2f} />)
    const data = screen.getByText((_, element) => element?.tagName === 'DATA')
    expect(data.getAttribute('value')).toBe('6703')
    const prefix = data.firstElementChild as HTMLElement
    expect(prefix.textContent).toBe('0x')
    expect(prefix.className).toBe('opacity-60')
    expect(data.className.split(' ')).toEqual(
      expect.arrayContaining(['tabular-nums', 'whitespace-nowrap']),
    )
  })

  it('passes className and attributes through', () => {
    render(<Hex value={1} className="text-accent" title="ip" />)
    const data = screen.getByTitle('ip')
    expect(data.className.endsWith(' text-accent')).toBe(true)
  })
})
