import { describe, expect, it } from 'bun:test'
import { render } from '@testing-library/react'
import { Skeleton } from '../../src/index'
import { html, useDom } from '../dom'

useDom()

describe('Skeleton', () => {
  it('draws a block and table rows', () => {
    const { container } = render(
      <>
        <Skeleton className="h-2.5 w-24" />
        <Skeleton rows={2} />
      </>,
    )
    expect(html(container)).toMatchSnapshot()
  })

  it('is a --panel-2 block, radius 3, sized by className, pulsing unless motion is reduced', () => {
    const { container } = render(<Skeleton className="h-6 w-16" />)
    const block = container.firstElementChild as HTMLElement
    expect(block.className.split(' ')).toEqual([
      'rounded-sm',
      'bg-panel-2',
      'animate-skeleton',
      'motion-reduce:animate-none',
      'h-6',
      'w-16',
    ])
  })

  it('draws `rows` rows 24 px apart, a short cell and a long one each', () => {
    const { container } = render(<Skeleton rows={4} />)
    const rows = [...(container.firstElementChild as HTMLElement).children]
    expect(rows).toHaveLength(4)
    for (const row of rows) {
      expect(row.className).toContain('h-6')
      const [short, long] = [...row.children]
      expect(short?.className).toContain('w-16')
      expect(long?.className).toContain('flex-1')
      expect(short?.className).toContain('bg-panel-2')
    }
  })

  it('is hidden from assistive tech', () => {
    const { container } = render(
      <>
        <Skeleton className="h-3" />
        <Skeleton rows={1} />
      </>,
    )
    for (const skeleton of container.children) {
      expect(skeleton.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('passes className and attributes through', () => {
    const { container } = render(<Skeleton rows={1} className="mt-3" data-part="rows" />)
    const skeleton = container.firstElementChild as HTMLElement
    expect(skeleton.className.endsWith(' mt-3')).toBe(true)
    expect(skeleton.dataset.part).toBe('rows')
  })
})
