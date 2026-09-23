import type { ReactNode } from 'react'

/** True when React draws something for `node`: not null, undefined, a boolean, or ''. */
export function hasContent(node: ReactNode): boolean {
  return node != null && typeof node !== 'boolean' && node !== ''
}
