import type { CSSProperties } from 'react'

/** Joins class names and skips the empty ones: `cx('p-3', dense && 'p-2', className)`. */
export function cx(...classes: readonly (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}

/**
 * Inline CSS variables, the one inline style the kit allows: `style={vars({ '--split': '40%' })}`.
 * A utility reads the variable (`basis-(--split)`), so the rules stay in the stylesheet.
 */
export function vars(values: Readonly<Record<`--${string}`, string | number>>): CSSProperties {
  return values as CSSProperties
}
