import { describe, expect, it } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { EmptyState } from '../../src/index'
import { html, useDom } from '../dom'

useDom()

describe('EmptyState', () => {
  it('draws the sentence and the action', () => {
    const { container } = render(
      <EmptyState action={{ label: 'submit a bot', href: '/hills/main/submit' }}>
        no entrants yet.
      </EmptyState>,
    )
    expect(html(container)).toMatchSnapshot()
  })

  it('says one muted sentence, then one accent action with an arrow (DESIGN_SYSTEM §4, §9)', () => {
    render(
      <EmptyState action={{ label: 'submit a bot', href: '/hills/main/submit' }}>
        no entrants yet.
      </EmptyState>,
    )
    const sentence = screen.getByText('no entrants yet.', { exact: false })
    expect(sentence.textContent).toBe('no entrants yet. submit a bot →')
    expect(sentence.parentElement?.className).toContain('text-muted')
    const link = screen.getByRole('link', { name: 'submit a bot' })
    expect(link.getAttribute('href')).toBe('/hills/main/submit')
    expect(link.className).toContain('text-accent-fg')
    expect(link.querySelector('[aria-hidden="true"]')?.textContent).toBe(' →')
  })

  it('is a button when the action has no href, and runs its onClick', () => {
    const clicks: string[] = []
    render(
      <EmptyState action={{ label: 'add a watch', onClick: () => clicks.push('add') }}>
        nothing watched.
      </EmptyState>,
    )
    const button = screen.getByRole('button', { name: 'add a watch' })
    expect(button.getAttribute('type')).toBe('button')
    fireEvent.click(button)
    expect(clicks).toEqual(['add'])
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('lets a router take the link over with onClick', () => {
    const went: string[] = []
    render(
      <EmptyState
        action={{
          label: 'open the arena',
          href: '/arena',
          onClick: (event) => {
            event.preventDefault()
            went.push('/arena')
          },
        }}
      >
        no battles yet.
      </EmptyState>,
    )
    const followed = fireEvent.click(screen.getByRole('link', { name: 'open the arena' }))
    expect(followed).toBe(false)
    expect(went).toEqual(['/arena'])
  })

  it('takes no click while its action is disabled', () => {
    const clicks: string[] = []
    render(
      <EmptyState action={{ label: 'retrying…', disabled: true, onClick: () => clicks.push('x') }}>
        could not load.
      </EmptyState>,
    )
    const button = screen.getByRole('button', { name: 'retrying…' })
    expect(button.hasAttribute('disabled')).toBe(true)
    fireEvent.click(button)
    expect(clicks).toEqual([])
    expect(button.className).toContain('disabled:text-dim')
  })

  it('packs into a dense panel: data type and 8 px of room', () => {
    const { container } = render(
      <EmptyState dense action={{ label: 'watch ip', onClick: () => {} }}>
        nothing watched yet.
      </EmptyState>,
    )
    const box = (container.firstElementChild as HTMLElement).className.split(' ')
    expect(box).toEqual(expect.arrayContaining(['px-1', 'py-2', 'text-data', 'text-muted']))
    expect(box).not.toContain('py-6')
    expect(box).not.toContain('text-body')
  })

  it('centers in the space the list would fill; className and attributes pass through', () => {
    const { container } = render(
      <EmptyState action={{ label: 'new', href: '#' }} className="h-40" data-list="bots">
        no bots yet.
      </EmptyState>,
    )
    const box = container.firstElementChild as HTMLElement
    expect(box.className.split(' ')).toEqual(
      expect.arrayContaining(['flex', 'items-center', 'justify-center', 'text-center', 'h-40']),
    )
    expect(box.dataset.list).toBe('bots')
  })
})
