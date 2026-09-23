import { describe, expect, it } from 'bun:test'
import { render, screen, within } from '@testing-library/react'
import { Header } from '../../src/index'
import { html, useDom } from '../dom'

useDom()

const brand = (
  <a href="/">
    ASM BOTS <span className="text-muted">{'// ARENA'}</span>
  </a>
)
const nav = (
  <>
    <a href="/arena" aria-current="page">
      arena
    </a>
    <a href="/editor">editor</a>
  </>
)

describe('Header', () => {
  it('draws brand, stat, nav, and the right slot', () => {
    const { container } = render(
      <Header
        brand={brand}
        stat="8 bots · 41 procs · cycle 12,480"
        nav={nav}
        right={<button type="button">theme</button>}
      />,
    )
    expect(html(container)).toMatchSnapshot()
  })

  it('is the banner, with the nav buttons in a navigation named primary', () => {
    render(<Header brand={brand} nav={nav} />)
    const banner = screen.getByRole('banner')
    const navigation = within(banner).getByRole('navigation', { name: 'primary' })
    expect(
      within(navigation)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['arena', 'editor'])
  })

  it('names the navigation with navLabel', () => {
    render(<Header nav={nav} navLabel="sections" />)
    expect(screen.getByRole('navigation', { name: 'sections' })).toBeTruthy()
  })

  it('is 40 px with a hairline bottom and 12 px sides (DESIGN_SYSTEM §4)', () => {
    render(<Header brand={brand} />)
    expect(screen.getByRole('banner').className.split(' ')).toEqual(
      expect.arrayContaining(['h-10', 'border-b', 'border-border', 'bg-bg', 'px-3', 'z-header']),
    )
  })

  it('sets the brand in brand type and accent, the stat in muted data type', () => {
    render(<Header brand={brand} stat="8 bots" />)
    expect(screen.getByRole('link', { name: 'ASM BOTS // ARENA' }).parentElement?.className).toBe(
      'shrink-0 text-brand text-accent',
    )
    expect(screen.getByText('8 bots').className).toBe('min-w-0 truncate text-data text-muted')
  })

  it('centers the stat in the space between brand and nav', () => {
    render(<Header brand={brand} stat="8 bots" nav={nav} />)
    const middle = screen.getByText('8 bots').parentElement as HTMLElement
    expect(middle.className).toBe('flex min-w-0 flex-1 justify-center')
    expect(middle.previousElementSibling?.textContent).toBe('ASM BOTS // ARENA')
    expect(middle.nextElementSibling?.tagName).toBe('NAV')
  })

  it('draws no nav or right slot when they are empty, and keeps the middle', () => {
    render(<Header brand={brand} />)
    const banner = screen.getByRole('banner')
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(banner.children).toHaveLength(2)
    expect(banner.lastElementChild?.className).toBe('flex min-w-0 flex-1 justify-center')
  })

  it('passes className and attributes through', () => {
    render(<Header className="sticky top-0" data-route="arena" />)
    const banner = screen.getByRole('banner')
    expect(banner.className.endsWith(' sticky top-0')).toBe(true)
    expect(banner.dataset.route).toBe('arena')
  })
})
