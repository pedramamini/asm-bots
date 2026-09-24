/**
 * One assemble as the editor needs it: `assemble` at the size cap, `lint`, and the size past the
 * cap. The Worker runs it (`asm.worker.ts`); so does the main thread when there is no Worker.
 */
import { assemble, lint } from '@asmbots/asm'
import type { AsmResult } from './protocol'

/** The most bytes a bot can have at all: the core (ISA §5.1). */
const CORE_BYTES = 0x10000

/** Assembles and lints `source` (never throws on bad source: each problem is a diagnostic). */
export function assembleSource(
  source: string,
  now: () => number = () => performance.now(),
): AsmResult {
  const start = now()
  const assembled = assemble(source)
  const warnings = lint(source, assembled)
  const errors = assembled.diagnostics.filter((d) => d.severity === 'error')
  let size: number | null = errors.length === 0 ? assembled.bytes.length : null
  if (errors.length > 0 && errors.every((d) => d.code === 'size-over-cap')) {
    // Over the cap and nothing else: the size badge still says by how much.
    const whole = assemble(source, { maxBytes: CORE_BYTES })
    if (!whole.diagnostics.some((d) => d.severity === 'error')) size = whole.bytes.length
  }
  return { source, assembled, warnings, size, ms: now() - start }
}
