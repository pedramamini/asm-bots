import { describe, expect, it } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { CoachMark, type CoachMarkPlacement, Kbd } from '../../src/index'
import { html, useDom } from '../dom'

useDom()

/** The mark's classes, and its caret's. */
function classesOf(placement?: CoachMarkPlacement) {
  render(
    <CoachMark placement={placement} onDismiss={() => {}}>
      press <Kbd>F5</Kbd> to debug.
    </CoachMark>,
  )
  const mark = screen.getByRole('note', { name: 'tip' })
  const caret = mark.querySelector('[aria-hidden="true"]') as HTMLElement
  return { mark: mark.className.split(' '), caret: caret.className.split(' ') }
}

describe('CoachMark', () => {
  it('draws the hint, the caret, and got it', () => {
    const { container } = render(
      <CoachMark onDismiss={() => {}}>
        assemble runs as you type; press <Kbd>F5</Kbd> to debug.
      </CoachMark>,
    )
    expect(html(container)).toMatchSnapshot()
  })

  it('is a note named tip: the hint, then got it, which dismisses it', () => {
    const dismissed: string[] = []
    render(
      <CoachMark onDismiss={() => dismissed.push('got it')}>
        press <Kbd>F5</Kbd> to debug.
      </CoachMark>,
    )
    const mark = screen.getByRole('note', { name: 'tip' })
    expect(mark.querySelector('p')?.textContent).toBe('press F5 to debug.')
    const button = screen.getByRole('button', { name: 'got it' })
    expect(button.getAttribute('type')).toBe('button')
    fireEvent.click(button)
    expect(dismissed).toEqual(['got it'])
  })

  it('dismisses on Escape, and on no other key', () => {
    const dismissed: string[] = []
    render(<CoachMark onDismiss={() => dismissed.push('escape')}>a hint.</CoachMark>)
    const button = screen.getByRole('button', { name: 'got it' })
    fireEvent.keyDown(button, { key: 'a' })
    fireEvent.keyDown(button, { key: 'Enter' })
    expect(dismissed).toEqual([])
    const kept = fireEvent.keyDown(button, { key: 'Escape' })
    expect(kept).toBe(false)
    expect(dismissed).toEqual(['escape'])
  })

  it('hangs under its control from the start edge, the caret pointing up', () => {
    const { mark, caret } = classesOf()
    expect(mark).toEqual(
      expect.arrayContaining(['absolute', 'top-full', 'left-0', 'mt-2', 'border-accent']),
    )
    expect(caret).toEqual(
      expect.arrayContaining(['absolute', 'rotate-45', '-top-1', 'left-2', 'border-t', 'border-l']),
    )
  })

  it('sits over its control from the end edge, the caret pointing down', () => {
    const { mark, caret } = classesOf('top-end')
    expect(mark).toEqual(expect.arrayContaining(['bottom-full', 'right-0', 'mb-2']))
    expect(mark).not.toContain('top-full')
    expect(caret).toEqual(expect.arrayContaining(['-bottom-1', 'right-2', 'border-r', 'border-b']))
  })

  it('takes its room in the flow when inline, as wide as its box, the caret pointing up', () => {
    const { mark, caret } = classesOf('inline')
    expect(mark).toEqual(expect.arrayContaining(['relative', 'w-full', 'mb-2']))
    expect(mark).not.toContain('absolute')
    expect(mark).not.toContain('w-64')
    expect(caret).toEqual(expect.arrayContaining(['-top-1', 'left-2', 'border-t', 'border-l']))
  })

  it('slides in, but not under reduced motion', () => {
    const { mark } = classesOf('top-start')
    expect(mark).toEqual(
      expect.arrayContaining([
        'starting:opacity-0',
        'starting:translate-y-1',
        'motion-reduce:transition-none',
      ]),
    )
  })

  it('shows a tour step, its own dismiss words, and an action beside them', () => {
    const done: string[] = []
    render(
      <CoachMark
        step="2/3"
        dismissLabel="skip the tour"
        action={{ label: 'next', onClick: () => done.push('next') }}
        onDismiss={() => done.push('skip')}
      >
        first blood: the events log has it.
      </CoachMark>,
    )
    const mark = screen.getByRole('note', { name: 'tip' })
    const row = screen.getByText('2/3').parentElement as HTMLElement
    expect(row.className.split(' ')).toEqual(expect.arrayContaining(['flex', 'justify-end']))
    expect(screen.getByText('2/3').className.split(' ')).toEqual(
      expect.arrayContaining(['mr-auto', 'text-muted']),
    )
    // The action is the accent button at the end; dismiss is the quiet one before it.
    const buttons = [...mark.querySelectorAll('button')].map((button) => button.textContent)
    expect(buttons).toEqual(['skip the tour', 'next'])
    const skip = screen.getByRole('button', { name: 'skip the tour' })
    const next = screen.getByRole('button', { name: 'next' })
    expect(next.className).toContain('text-accent-fg')
    expect(skip.className).not.toContain('border-accent')
    expect(screen.queryByRole('button', { name: 'got it' })).toBeNull()
    fireEvent.click(next)
    fireEvent.click(skip)
    // Escape on either button dismisses.
    fireEvent.keyDown(next, { key: 'Escape' })
    expect(done).toEqual(['next', 'skip', 'skip'])
  })

  it('keeps got it alone, in accent, with no step and no action', () => {
    render(<CoachMark onDismiss={() => {}}>a hint.</CoachMark>)
    const mark = screen.getByRole('note', { name: 'tip' })
    const button = screen.getByRole('button', { name: 'got it' })
    expect(button.parentElement).toBe(mark)
    expect(button.className).toContain('border-accent')
  })

  it('passes className and attributes through', () => {
    render(
      <CoachMark onDismiss={() => {}} className="max-w-60" data-coach="editor">
        a hint.
      </CoachMark>,
    )
    const mark = screen.getByRole('note', { name: 'tip' })
    expect(mark.className.split(' ')).toContain('max-w-60')
    expect(mark.dataset.coach).toBe('editor')
  })
})
