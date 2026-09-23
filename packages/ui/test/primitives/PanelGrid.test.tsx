import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { Panel, PanelGrid } from '../../src/index'
import { html, useDom } from '../dom'

useDom()

describe('PanelGrid', () => {
  it('lays panels on 12 columns', () => {
    const { container } = render(
      <PanelGrid>
        <Panel title="arena" className="col-span-8" />
        <Panel title="roster" className="col-span-4" />
      </PanelGrid>,
    )
    expect(html(container)).toMatchSnapshot()
  })

  it('is a plain grid with 12 px gutters (DESIGN_SYSTEM §4); its panels are the regions', () => {
    render(
      <PanelGrid data-testid="grid">
        <Panel title="hill" className="col-span-6" />
        <Panel title="recent matches" className="col-span-6" />
      </PanelGrid>,
    )
    const grid = screen.getByTestId('grid')
    expect(grid.getAttribute('role')).toBeNull()
    expect(grid.className).toBe('grid grid-cols-12 gap-3')
    expect(screen.getAllByRole('region').map((region) => region.parentElement)).toEqual([
      grid,
      grid,
    ])
  })

  it('passes className and attributes through', () => {
    render(<PanelGrid className="p-3" aria-label="dashboard" role="group" />)
    const grid = screen.getByRole('group', { name: 'dashboard' })
    expect(grid.className).toBe('grid grid-cols-12 gap-3 p-3')
  })
})
