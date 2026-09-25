import { describe, expect, it } from 'bun:test'
import { render, screen, within } from '@testing-library/react'
import { Panel, PanelHost } from '../../src/index'
import { html, useDom } from '../dom'

useDom()

describe('Panel', () => {
  it('draws the title row over the body', () => {
    const { container } = render(
      <Panel
        title="traffic distribution"
        status="loading"
        actions={<button type="button">refresh</button>}
      >
        <p>no rows yet</p>
      </Panel>,
    )
    expect(html(container)).toMatchSnapshot()
  })

  it('is a region named by its title, which is a level-2 heading', () => {
    render(<Panel title="registers">ax 0000</Panel>)
    const region = screen.getByRole('region', { name: 'registers' })
    expect(within(region).getByRole('heading', { level: 2 }).textContent).toBe('registers')
    expect(region.textContent).toContain('ax 0000')
  })

  it('is no region without a title, and has no title row with nothing to put in it', () => {
    const { container } = render(<Panel>ax 0000</Panel>)
    expect(screen.queryByRole('region')).toBeNull()
    expect(container.querySelector('header')).toBeNull()
  })

  it('keeps the status and the actions right of the title, over a hairline', () => {
    render(
      <Panel title="hills" status="3 active" actions={<button type="button">refresh</button>} />,
    )
    const row = screen.getByRole('heading').closest('header') as HTMLElement
    expect(row.className.split(' ')).toEqual(
      expect.arrayContaining(['border-b', 'border-border', 'pb-2', 'mb-3']),
    )
    expect(row.textContent).toBe('hills3 activerefresh')
    expect(screen.getByText('3 active').className).toBe(
      'ml-auto shrink-0 text-panel-status text-muted',
    )
    const tools = screen.getByRole('button', { name: 'refresh' }).parentElement as HTMLElement
    expect(tools.parentElement).toBe(row)
    expect(tools.className.split(' ')).toEqual(expect.arrayContaining(['-my-1.5', 'ml-auto']))
  })

  it('wraps the actions to a line of their own on a phone, and keeps the status by the title', () => {
    render(
      <Panel
        title="hill main"
        status="14 of 32"
        actions={<button type="button">sign in to submit</button>}
      />,
    )
    const heading = screen.getByRole('heading', { level: 2 })
    const row = heading.closest('header') as HTMLElement
    expect(row.className.split(' ')).toContain('max-md:flex-wrap')
    // The title and status share one flex item, so a wrap never parts them.
    const titleLine = heading.parentElement as HTMLElement
    expect(titleLine.parentElement).toBe(row)
    expect(titleLine.contains(screen.getByText('14 of 32'))).toBe(true)
    expect(titleLine.className.split(' ')).toEqual(expect.arrayContaining(['min-w-0', 'flex-auto']))
    expect(heading.className.split(' ')).toContain('truncate')
    // The actions are the row's other item, right-aligned on whichever line they land.
    const tools = screen.getByRole('button').parentElement as HTMLElement
    expect(tools.parentElement).toBe(row)
    expect(tools.className.split(' ')).toEqual(expect.arrayContaining(['ml-auto', 'shrink-0']))
    expect(screen.getByRole('region', { name: 'hill main' })).toBeTruthy()
  })

  it('draws the status and actions without a title', () => {
    render(<Panel status="loading" />)
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.getByText('loading').closest('header')).not.toBeNull()
  })

  it('treats false, null, and empty slots as absent', () => {
    const { container } = render(
      <Panel title={false} status={null} actions="">
        body
      </Panel>,
    )
    expect(container.querySelector('header')).toBeNull()
  })

  it('is a panel-fill surface with a 1 px border, radius 4, and padding 12 (DESIGN_SYSTEM §4)', () => {
    render(<Panel title="memory" />)
    const panel = screen.getByRole('region')
    expect(panel.className.split(' ')).toEqual(
      expect.arrayContaining(['bg-panel', 'border', 'border-border', 'rounded-md', 'p-3']),
    )
    expect(screen.getByRole('heading').className).toBe(
      'min-w-0 truncate text-panel-title text-accent-fg',
    )
  })

  it('pads 8 when dense', () => {
    render(<Panel title="queue" dense />)
    const panel = screen.getByRole('region')
    expect(panel.className).toContain('p-2')
    expect(panel.className).not.toContain('p-3')
    const row = screen.getByRole('heading').closest('header') as HTMLElement
    expect(row.className.split(' ')).toEqual(expect.arrayContaining(['pb-1', 'mb-2']))
  })

  it('passes className, attributes, and ref through to the section', () => {
    let ref: HTMLElement | null = null
    render(
      <Panel
        title="arena"
        className="col-span-8"
        id="arena"
        data-state="live"
        ref={(node) => {
          ref = node
        }}
      />,
    )
    const panel = screen.getByRole('region', { name: 'arena' })
    expect(panel.className.endsWith(' col-span-8')).toBe(true)
    expect(panel.id).toBe('arena')
    expect(panel.dataset.state).toBe('live')
    expect(ref).toBe(panel)
  })

  it('lets aria-label override the title as the name', () => {
    render(<Panel title="mem" aria-label="memory view" />)
    expect(screen.getByRole('region', { name: 'memory view' })).toBeTruthy()
  })
})

describe('PanelHost', () => {
  it('ends the title row with the host’s controls, and fills the host', () => {
    render(
      <PanelHost chrome={<button type="button">move</button>} fill>
        <Panel title="memory" actions={<button type="button">goto</button>}>
          <Panel title="inner">rows</Panel>
        </Panel>
      </PanelHost>,
    )
    const outer = screen.getByRole('region', { name: 'memory' })
    const buttons = within(outer)
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(buttons).toEqual(['goto', 'move'])
    expect(outer.className).toContain('h-full')
    // A panel inside the hosted one is not the host's.
    const inner = screen.getByRole('region', { name: 'inner' })
    expect(within(inner).queryByRole('button')).toBeNull()
    expect(inner.className).not.toContain('h-full')
  })

  it('draws a title row for the host’s controls alone', () => {
    render(
      <PanelHost chrome={<button type="button">move</button>}>
        <Panel>body</Panel>
      </PanelHost>,
    )
    expect(screen.getByRole('button', { name: 'move' }).closest('header')).not.toBeNull()
  })
})
