import { EmptyState } from '@asmbots/ui'
import { useOnline } from './online'

/** A read that can fail and run again: a TanStack query's result has these. */
export interface RetryableRead {
  readonly error: Error | null
  readonly refetch: () => Promise<unknown>
}

export interface LoadFailureProps {
  read: RetryableRead
  /** What did not load, when the panel's title does not say: `the server's tournaments`. */
  what?: string | undefined
  /** For a dense panel, or a line among others. */
  dense?: boolean | undefined
}

/**
 * What a panel says in place of a read that failed: the API's own words, and `retry`, which reads
 * it again. A retry clears the error (TanStack does, for a read with no data yet), so the panel
 * shows its loading state until the answer. Offline it says so instead: the network's return reads
 * it again by itself (TanStack's refetch on reconnect). Nothing while the read has no error.
 */
export function LoadFailure({ read, what, dense }: LoadFailureProps) {
  const online = useOnline()
  if (read.error === null) return null
  return (
    <EmptyState dense={dense} action={{ label: 'retry', onClick: () => void read.refetch() }}>
      <span className="text-danger">
        {online
          ? `could not load${what === undefined ? '' : ` ${what}`}: ${read.error.message}`
          : `offline: ${what ?? 'it'} will load once the network is back.`}
      </span>
    </EmptyState>
  )
}

/** A panel's status for a read: `loading`, `error`, or what `ready` says of the data. */
export function readStatus<T>(
  data: T | undefined,
  error: Error | null,
  ready: (data: T) => string,
): string {
  if (data !== undefined) return ready(data)
  return error === null ? 'loading' : 'error'
}
