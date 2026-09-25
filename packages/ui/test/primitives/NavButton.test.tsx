import { describe, expect, it } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { CodeXml, Grid2x2 } from 'lucide-react'
import { createRef } from 'react'
import { NavButton } from '../../src/index'
import { html, useDom } from '../dom'

useDom()

const link = (name: string) => screen.getByRole('link', { name })
const classes = (element: Element) => element.className.split(' ')

function Nav() {
  return (
    <nav aria-label="primary">
      <NavButton href="/arena" icon={Grid2x2} active>
        arena
      </NavButton>
      <NavButton href="/editor" icon={CodeXml}>
        editor
      </NavButton>
    </nav>
  )
}

describe('NavButton', () => {
  it('draws the active and an idle route', () => {
    const { container } = render(<Nav />)
    expect(html(container)).toMatchSnapshot()
  })

  it('is a link; the active one is the current page', () => {
    render(<Nav />)
    expect(link('arena').getAttribute('href')).toBe('/arena')
    expect(link('arena').getAttribute('aria-current')).toBe('page')
    expect(link('editor').getAttribute('aria-current')).toBeNull()
  })

  it('is a 24 px bordered box, padding 4 10, in UPPER nav type (DESIGN_SYSTEM §3, §4)', () => {
    render(<Nav />)
    expect(classes(link('editor'))).toEqual(
      expect.arrayContaining(['h-6', 'px-2.5', 'gap-1.5', 'rounded-sm', 'border', 'text-nav']),
    )
  })

  it('is muted in a hairline, strong on hover; active is accent over the 10% fill', () => {
    render(<Nav />)
    expect(classes(link('editor'))).toEqual(
      expect.arrayContaining([
        'border-border',
        'text-muted',
        'not-disabled:hover:border-border-strong',
      ]),
    )
    expect(classes(link('arena'))).toEqual(
      expect.arrayContaining(['border-accent', 'bg-accent-10', 'text-accent-fg']),
    )
    expect(classes(link('arena'))).not.toContain('border-border')
  })

  it('draws a 12 px icon, accent even while idle (as in the reference)', () => {
    render(<Nav />)
    const idle = link('editor').querySelector('svg') as SVGElement
    expect(idle.getAttribute('width')).toBe('12')
    expect(idle.getAttribute('stroke-width')).toBe('1.75')
    expect(idle.getAttribute('aria-hidden')).toBe('true')
    expect(idle.getAttribute('class')).toContain('text-accent-fg')
    // Active, the whole button is accent: the icon takes it from the text.
    expect(link('arena').querySelector('svg')?.getAttribute('class')).not.toContain(
      'text-accent-fg',
    )
  })

  it('lets a router take the click, and passes className, attributes, and ref through', () => {
    const ref = createRef<HTMLAnchorElement>()
    const routes: string[] = []
    render(
      <NavButton
        ref={ref}
        href="/docs"
        className="ml-2"
        aria-current="location"
        onClick={(event) => {
          event.preventDefault()
          routes.push(event.currentTarget.getAttribute('href') ?? '')
        }}
      >
        docs
      </NavButton>,
    )
    expect(ref.current).toBe(link('docs') as HTMLAnchorElement)
    expect(link('docs').className.endsWith(' ml-2')).toBe(true)
    expect(link('docs').getAttribute('aria-current')).toBe('location')
    fireEvent.click(link('docs'))
    expect(routes).toEqual(['/docs'])
  })
})
