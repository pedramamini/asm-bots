import { Button, hexAddress, Panel } from '@asmbots/ui'
import { Copy, RotateCw } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode, useState } from 'react'

/** The text of anything thrown: the stack when there is one, else the message or the value. */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`
  return String(error)
}

/**
 * Where it broke, as the kit shows an address: a 16-bit FNV-1a hash of the error's text. The
 * same error gets the same address, so two reports of one bug read alike.
 */
export function errorAddress(error: unknown): string {
  let hash = 0x811c9dc5
  for (const char of errorText(error)) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return hexAddress((hash ^ (hash >>> 16)) & 0xffff)
}

export interface ErrorPageProps {
  error: unknown
  /** Reloads the page; a test passes its own. */
  onReload?: (() => void) | undefined
}

/** The page a crash leaves: where it broke, the stack to copy, and a way back. */
export function ErrorPage({ error, onReload = () => location.reload() }: ErrorPageProps) {
  const text = errorText(error)
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(text).then(
      () => setCopied(true),
      () => setCopied(false),
    )
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-[960px] flex-col justify-center gap-3 p-3">
      <Panel
        title={`something broke at ${errorAddress(error)}`}
        status="the page stopped here"
        actions={
          <>
            <Button size="sm" icon={Copy} onClick={copy}>
              {copied ? 'copied' : 'copy stack'}
            </Button>
            <Button size="sm" variant="primary" icon={RotateCw} onClick={onReload}>
              reload
            </Button>
          </>
        }
      >
        <pre className="max-h-[60dvh] overflow-auto whitespace-pre-wrap break-words text-code text-muted">
          {text}
        </pre>
      </Panel>
    </main>
  )
}

/** Catches what the router does not (a provider, the router itself) and shows `ErrorPage`. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  override state: { error: unknown } = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  override render() {
    return this.state.error === null ? this.props.children : <ErrorPage error={this.state.error} />
  }
}
