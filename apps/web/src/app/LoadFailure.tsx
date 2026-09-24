/** What a panel says when its read failed: the API's own words. */
export function LoadFailure({ error }: { error: Error }) {
  return <p className="text-data text-danger">could not load: {error.message}</p>
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
