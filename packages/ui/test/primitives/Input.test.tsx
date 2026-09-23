import { describe, expect, it } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { createRef, useState } from 'react'
import { Input } from '../../src/index'
import { html, useDom } from '../dom'

useDom()

const field = () => screen.getByRole('textbox') as HTMLInputElement

/** Types `text` at the caret, one change per character, as a keyboard does. */
function type(input: HTMLInputElement, text: string): void {
  for (const char of text) {
    const at = input.selectionStart ?? input.value.length
    const next = input.value.slice(0, at) + char + input.value.slice(input.selectionEnd ?? at)
    fireEvent.change(input, {
      target: { value: next, selectionStart: at + 1, selectionEnd: at + 1 },
    })
  }
}

describe('Input', () => {
  it('draws the field with the prompt glyph, and the mono variant', () => {
    const { container } = render(
      <>
        <Input aria-label="search bots" placeholder="search bots..." className="w-72" />
        <Input aria-label="goto" mono placeholder="0x0000" />
        <Input aria-label="name" prompt={null} />
      </>,
    )
    expect(html(container)).toMatchSnapshot()
  })

  it('is a 24 px field: --panel-2 fill, a hairline, 12 px data type (DESIGN_SYSTEM §3, §4)', () => {
    render(<Input aria-label="search bots" />)
    expect(field().className.split(' ')).toEqual(
      expect.arrayContaining(['h-full', 'bg-panel-2', 'border', 'border-border', 'rounded-sm']),
    )
    expect(field().className.split(' ')).toEqual(
      expect.arrayContaining(['text-data', 'text-text', 'placeholder:text-muted']),
    )
    expect((field().parentElement as HTMLElement).className.split(' ')).toContain('h-6')
  })

  it('has no focus ring: focus turns the border accent', () => {
    render(<Input aria-label="search bots" />)
    const classes = field().className.split(' ')
    expect(classes).toEqual(expect.arrayContaining(['outline-hidden', 'focus:border-accent']))
    expect(classes.filter((name) => name.includes('outline-'))).toEqual(['outline-hidden'])
  })

  it('shows the > prompt in --text-dim, hidden from assistive tech and from the pointer', () => {
    render(<Input aria-label="search bots" />)
    const glyph = field().nextElementSibling as HTMLElement
    expect(glyph.textContent).toBe('>')
    expect(glyph.getAttribute('aria-hidden')).toBe('true')
    expect(glyph.className.split(' ')).toEqual(
      expect.arrayContaining(['text-dim', 'pointer-events-none', 'absolute', 'left-2']),
    )
    expect(field().className.split(' ')).toContain('pl-6')
  })

  it('takes another prompt, or none', () => {
    const { unmount } = render(<Input aria-label="goto" prompt="@" />)
    expect(field().nextElementSibling?.textContent).toBe('@')
    unmount()
    render(<Input aria-label="name" prompt={null} />)
    expect(field().nextElementSibling).toBeNull()
    expect(field().className.split(' ')).toContain('pl-2')
  })

  it('passes className to the box, and the other props and the ref to the <input>', () => {
    const ref = createRef<HTMLInputElement>()
    const changes: string[] = []
    render(
      <Input
        ref={ref}
        className="w-72"
        aria-label="search bots"
        name="q"
        placeholder="search bots..."
        onChange={(event) => changes.push(event.target.value)}
      />,
    )
    expect(ref.current).toBe(field())
    expect((field().parentElement as HTMLElement).className.endsWith(' w-72')).toBe(true)
    expect(field().name).toBe('q')
    expect(field().placeholder).toBe('search bots...')
    fireEvent.change(field(), { target: { value: 'dwarf' } })
    expect(changes).toEqual(['dwarf'])
  })

  it('fades a disabled field', () => {
    render(<Input aria-label="search bots" disabled />)
    expect(field().disabled).toBe(true)
    expect((field().parentElement as HTMLElement).className).toContain('has-disabled:opacity-40')
  })

  describe('mono (the hex field)', () => {
    it('accepts 0x1A2F', () => {
      const changes: string[] = []
      render(
        <Input aria-label="goto" mono onChange={(event) => changes.push(event.target.value)} />,
      )
      fireEvent.change(field(), { target: { value: '0x1A2F' } })
      expect(field().value).toBe('0x1A2F')
      expect(changes).toEqual(['0x1A2F'])
    })

    it('rejects xyz', () => {
      const changes: string[] = []
      render(
        <Input aria-label="goto" mono onChange={(event) => changes.push(event.target.value)} />,
      )
      fireEvent.change(field(), { target: { value: 'xyz' } })
      expect(field().value).toBe('')
      type(field(), 'xyz')
      expect(field().value).toBe('')
      expect(changes).toEqual([])
    })

    it('takes the keystrokes of 0x1a2f, writing the digits uppercase', () => {
      render(<Input aria-label="goto" mono />)
      type(field(), '0x1a2f')
      expect(field().value).toBe('0x1A2F')
    })

    it('drops a bad keystroke mid-field and keeps the caret where it was', () => {
      render(<Input aria-label="goto" mono defaultValue="0x1A" />)
      field().setSelectionRange(3, 3)
      type(field(), 'z')
      expect(field().value).toBe('0x1A')
      expect([field().selectionStart, field().selectionEnd]).toEqual([3, 3])
      type(field(), 'b')
      expect(field().value).toBe('0x1BA')
      expect(field().selectionStart).toBe(4)
    })

    it('holds an address to 4 digits and a byte to 2', () => {
      const { unmount } = render(<Input aria-label="goto" mono />)
      type(field(), '0x1A2F0')
      expect(field().value).toBe('0x1A2F')
      expect(field().maxLength).toBe(6)
      unmount()
      render(<Input aria-label="byte" mono digits={2} />)
      type(field(), 'ff0')
      expect(field().value).toBe('FF')
    })

    it('works controlled: the caller sees only accepted, normalized text', () => {
      const seen: string[] = []
      function Goto() {
        const [value, setValue] = useState('')
        return (
          <Input
            aria-label="goto"
            mono
            value={value}
            onChange={(event) => {
              seen.push(event.target.value)
              setValue(event.target.value)
            }}
          />
        )
      }
      render(<Goto />)
      type(field(), '0x1g')
      expect(field().value).toBe('0x1')
      fireEvent.change(field(), { target: { value: '0x1ab' } })
      expect(field().value).toBe('0x1AB')
      fireEvent.change(field(), { target: { value: 'nope' } })
      expect(field().value).toBe('0x1AB')
      expect(seen).toEqual(['0', '0x', '0x1', '0x1AB'])
    })

    it('turns off the browser’s help: no autocomplete, spellcheck, or autocorrect', () => {
      render(<Input aria-label="goto" mono />)
      expect(field().type).toBe('text')
      expect(field().getAttribute('autocomplete')).toBe('off')
      expect(field().getAttribute('autocorrect')).toBe('off')
      expect(field().getAttribute('autocapitalize')).toBe('characters')
      expect(field().getAttribute('spellcheck')).toBe('false')
    })

    it('leaves a plain field’s text alone', () => {
      render(<Input aria-label="search bots" />)
      fireEvent.change(field(), { target: { value: 'xyz' } })
      expect(field().value).toBe('xyz')
    })
  })
})
