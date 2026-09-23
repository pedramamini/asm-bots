import { describe, expect, it } from 'bun:test'
import { render, screen, within } from '@testing-library/react'
import { Panel } from '../../src/index'
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
    const row = screen.getByRole('heading').parentElement as HTMLElement
    expect(row.className.split(' ')).toEqual(
      expect.arrayContaining(['border-b', 'border-border', 'pb-2', 'mb-3']),
    )
    const right = row.lastElementChild as HTMLElement
    expect(right.className).toContain('ml-auto')
    expect(right.textContent).toBe('3 activerefresh')
    expect(screen.getByText('3 active').className).toBe('text-panel-status text-muted')
    expect(screen.getByRole('button', { name: 'refresh' }).parentElement?.className).toContain(
      '-my-1.5',
    )
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
      'min-w-0 truncate text-panel-title text-accent',
    )
  })

  it('pads 8 when dense', () => {
    render(<Panel title="queue" dense />)
    const panel = screen.getByRole('region')
    expect(panel.className).toContain('p-2')
    expect(panel.className).not.toContain('p-3')
    const row = screen.getByRole('heading').parentElement as HTMLElement
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
