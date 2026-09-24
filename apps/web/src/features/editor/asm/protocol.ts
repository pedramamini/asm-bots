/**
 * The assembler Worker's protocol (`asm.worker.ts`): the editor sends its source, and the Worker
 * sends back the assemble and the lint of it (`@asmbots/asm`, ISA §6). An answer carries the id
 * of its request, so the editor keeps only the answer to the last one it sent.
 */
import type { Assembled, Diag } from '@asmbots/asm'

/** Assemble and lint `source`. */
export interface AsmRequest {
  readonly id: number
  readonly source: string
}

/** What the editor shows of one source: its assemble, its lint, and its size. */
export interface AsmResult {
  /** The source, as it was assembled. */
  readonly source: string
  /** The assemble at the hills' size cap (`MAX_BOT_BYTES`): its errors, bytes, and listing. */
  readonly assembled: Assembled
  /** The linter's warnings. */
  readonly warnings: readonly Diag[]
  /**
   * The image size in bytes, past the cap too: a bot whose only errors are `size-over-cap` is
   * assembled again without the cap to measure it. Null when there are other errors, or when the
   * bot runs past 64 KB.
   */
  readonly size: number | null
  /** How long the assemble and the lint took, ms. */
  readonly ms: number
}

/** The answer to an `AsmRequest`: its result, or why there is none. */
export type AsmReply =
  | { readonly id: number; readonly result: AsmResult }
  | { readonly id: number; readonly error: string }

/** The errors of a result: a bot with any has no bytes (ISA §6.5). */
export function resultErrors(result: AsmResult): Diag[] {
  return result.assembled.diagnostics.filter((d) => d.severity === 'error')
}
