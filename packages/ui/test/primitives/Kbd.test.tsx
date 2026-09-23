import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { Kbd } from '../../src/index'
import { html, useDom } from '../dom'

useDom()

describe('Kbd', () => {
  it('draws a keycap', () => {
    const { container } = render(<Kbd>space</Kbd>)
    expect(html(container)).toMatchSnapshot()
  })

  it('is a <kbd>: a 16 px keycap in 10 px UPPER muted type', () => {
    render(<Kbd>?</Kbd>)
    const key = screen.getByText('?')
    expect(key.tagName).toBe('KBD')
    expect(key.className.split(' ')).toEqual(
      expect.arrayContaining([
        'h-4',
        'min-w-4',
        'border',
        'border-border-strong',
        'bg-panel-2',
        'rounded-sm',
        'text-panel-status',
        'text-muted',
      ]),
    )
  })

  it('passes className and attributes through', () => {
    render(
      <Kbd className="ml-auto" title="toggle the key help">
        ?
      </Kbd>,
    )
    const key = screen.getByText('?')
    expect(key.className.endsWith(' ml-auto')).toBe(true)
    expect(key.title).toBe('toggle the key help')
  })
})
