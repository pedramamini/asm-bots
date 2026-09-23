import { type ChangeEvent, type ComponentProps, type ReactNode, useRef } from 'react'
import { maskHex } from '../hex'
import { hasContent } from '../node'
import { cx } from '../style'

export interface InputProps extends ComponentProps<'input'> {
  /** The glyph before the text, in `--text-dim`: `>` by default, null for none. */
  prompt?: ReactNode
  /**
   * The numeric variant: a hex field (`0x1A2F`, `FF`). The mask takes hex digits after an optional
   * `0x`, writes the digits uppercase, and drops a keystroke or a paste that would break the form.
   */
  mono?: boolean | undefined
  /** A mono field's most hex digits: 4 for an address (the default), 2 for a byte. */
  digits?: number | undefined
}

/** What a mono field sets before the caller's props: plain text, no help from the browser. */
const HEX_FIELD = {
  type: 'text',
  autoCapitalize: 'characters',
  autoComplete: 'off',
  autoCorrect: 'off',
  spellCheck: false,
} as const

/**
 * A text field (DESIGN_SYSTEM §4): `--panel-2` fill, a hairline, the `> ` prompt glyph in
 * `--text-dim`, 12 px data type. No focus ring: focus turns the border accent. `className` sizes
 * the field (`w-72`, `flex-1`); every other prop, the ref included, goes to the `<input>`.
 */
export function Input({
  prompt = '>',
  mono = false,
  digits = 4,
  className,
  onChange,
  ...rest
}: InputProps) {
  /** A mono field's last accepted text: a rejected change puts it back. */
  const accepted = useRef(String(rest.value ?? rest.defaultValue ?? ''))
  const prompted = hasContent(prompt)

  const onMaskedChange = (event: ChangeEvent<HTMLInputElement>) => {
    const field = event.currentTarget
    const previous = rest.value === undefined ? accepted.current : String(rest.value)
    const masked = maskHex(field.value, digits)
    if (masked === null) {
      // Rejected: the field keeps its text, and the caret stays where the keystroke found it.
      const caret = (field.selectionStart ?? 0) - (field.value.length - previous.length)
      const at = Math.min(previous.length, Math.max(0, caret))
      field.value = previous
      field.setSelectionRange(at, at)
      return
    }
    if (masked !== field.value) {
      const { selectionStart, selectionEnd } = field
      field.value = masked
      field.setSelectionRange(selectionStart, selectionEnd)
    }
    accepted.current = masked
    onChange?.(event)
  }

  return (
    <span className={cx('relative inline-flex h-6 min-w-0 has-disabled:opacity-40', className)}>
      <input
        {...(mono ? { ...HEX_FIELD, maxLength: digits + 2 } : undefined)}
        {...rest}
        onChange={mono ? onMaskedChange : onChange}
        className={cx(
          'h-full w-full min-w-0 rounded-sm border border-border bg-panel-2 pr-2 text-data text-text outline-hidden transition-colors duration-120 ease-out placeholder:text-muted not-disabled:hover:border-border-strong focus:border-accent disabled:cursor-not-allowed',
          prompted ? 'pl-6' : 'pl-2',
        )}
      />
      {prompted && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-data text-dim select-none"
        >
          {prompt}
        </span>
      )}
    </span>
  )
}
