import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { StatusBar } from '../../src/index'
import { html, useDom } from '../dom'

useDom()

describe('StatusBar', () => {
  it('draws the left, center, and right chips', () => {
    const { container } = render(
      <StatusBar
        left={<span>3 active · 2 major</span>}
        center={<a href="https://runmaestro.ai">made with maestro</a>}
        right={
          <>
            <span>2026.09.23a</span>
            <span>60 fps</span>
          </>
        }
      />,
    )
    expect(html(container)).toMatchSnapshot()
  })

  it('is the contentinfo landmark', () => {
    render(<StatusBar left="ok" />)
    expect(screen.getByRole('contentinfo').textContent).toBe('ok')
  })

  it('keeps the center chip on the center line: equal side columns around it', () => {
    render(<StatusBar left="a" center="b" right="c" />)
    const bar = screen.getByRole('contentinfo')
    expect(bar.className).toContain('grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]')
    expect([...bar.children].map((zone) => zone.textContent)).toEqual(['a', 'b', 'c'])
    expect(bar.lastElementChild?.className).toContain('justify-end')
  })

  it('is 22 px, and only its chips take pointer events', () => {
    render(<StatusBar left={<span>live</span>} />)
    const bar = screen.getByRole('contentinfo')
    expect(bar.className.split(' ')).toEqual(
      expect.arrayContaining(['h-5.5', 'pointer-events-none', 'px-3']),
    )
    for (const zone of bar.children) expect(zone.className).toContain('*:pointer-events-auto')
  })

  it('passes className and attributes through', () => {
    render(<StatusBar className="absolute inset-x-0 bottom-3" aria-label="status" />)
    const bar = screen.getByRole('contentinfo', { name: 'status' })
    expect(bar.className.endsWith(' absolute inset-x-0 bottom-3')).toBe(true)
  })
})
