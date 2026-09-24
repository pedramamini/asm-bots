/**
 * Schema pieces the protocol's types share, and `parse`, which turns zod's issues into one line a
 * page can show: the first problem, in words.
 */
import * as z from 'zod/mini'

/** A value the protocol does not accept. Its message says what is wrong, lowercase. */
export class ProtocolError extends Error {
  override readonly name = 'ProtocolError'
}

export const UINT32 = 0xffff_ffff

/** An integer in `min..max`, and the message that says so when it is not. */
export function whole(what: string, min: number, max: number) {
  const range = `${min.toLocaleString('en-US')}..${max.toLocaleString('en-US')}`
  return z
    .number()
    .check(
      z.refine(
        (n) => Number.isInteger(n) && n >= min && n <= max,
        `${what} must be a whole number in ${range}`,
      ),
    )
}

/** A string that `pattern` matches whole. */
export function matching(pattern: RegExp) {
  return z.string().check(z.regex(pattern))
}

/** FNV-1a 64 in lowercase hex: result hashes and match keys (ISA §5.6). */
export const HASH64 = /^[0-9a-f]{16}$/
/** SHA-256 in lowercase hex. */
export const SHA256 = /^[0-9a-f]{64}$/
/** Standard base64, padded, not empty. */
export const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
/** A name as the arena shows it: one line, 1..64 characters. */
export const NAME = /^[^\n\r]{1,64}$/
/** A row id: what D1 keys a row by. */
export const Id = z.string().check(z.minLength(1), z.maxLength(64))
/** A slug in a URL: `main`, `dwarf-2`. */
export const Slug = matching(/^[a-z0-9][a-z0-9-]{0,63}$/)
/** A time, ISO 8601. */
export const Timestamp = z.string().check(z.minLength(1), z.maxLength(40))

/** `path` as it reads in a message: `bots[1].sha256`. */
function where(path: readonly PropertyKey[]): string {
  let text = ''
  for (const part of path) {
    text += typeof part === 'number' ? `[${part}]` : `${text === '' ? '' : '.'}${String(part)}`
  }
  return text
}

/** The first of `error`'s issues, in words. */
export function describe(error: z.core.$ZodError, what: string): string {
  const issue = error.issues[0]
  if (issue === undefined) return `${what} is not well formed`
  const at = issue.path.length === 0 ? what : where(issue.path)
  if (issue.code === 'custom') return issue.message
  if (issue.code === 'invalid_type' && issue.input === undefined) return `${at} is missing`
  return `${at} is not well formed`
}

/** `value` as `schema` reads it, or a `ProtocolError` that says what is wrong with it. */
export function parse<S extends z.ZodMiniType>(
  schema: S,
  value: unknown,
  what: string,
): z.output<S> {
  const result = schema.safeParse(value, { reportInput: true })
  if (!result.success) throw new ProtocolError(describe(result.error, what))
  return result.data
}
