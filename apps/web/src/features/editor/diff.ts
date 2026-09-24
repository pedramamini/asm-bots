/**
 * A tiny LCS diff, for the versions view (lines) and for the formatter's edit (lines, then the
 * characters of each changed line), so a format moves the cursor with the text it was in.
 */
import type { ChangeSpec, Text } from '@codemirror/state'

/**
 * A step of a diff: an item both sides have (`=`), one only the old side has (`-`), or only the
 * new (`+`). `text` is the old side's item, or the new side's for `+`; `into` is the new side's
 * item of a `=` whose two items `same` held equal without being identical.
 */
export interface DiffOp {
  readonly op: '=' | '-' | '+'
  readonly text: string
  readonly into?: string | undefined
}

/**
 * The most cells the LCS table may have. Past it (two 2,000-line texts that share little), the
 * middle of the diff is one block: all of the old side out, all of the new side in.
 */
export const MAX_DIFF_CELLS = 4_000_000

type Same = (a: string, b: string) => boolean

const identical: Same = (a, b) => a === b

/**
 * The steps from `a` to `b`: a longest common subsequence of items that `same` holds equal stays,
 * the rest goes out and comes in. In each run of changes the removals come first, then the
 * additions, as a unified diff lists them.
 */
export function diffSequences(
  a: readonly string[],
  b: readonly string[],
  same: Same = identical,
): DiffOp[] {
  let start = 0
  while (start < a.length && start < b.length && same(a[start] as string, b[start] as string)) {
    start++
  }
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && same(a[endA - 1] as string, b[endB - 1] as string)) {
    endA--
    endB--
  }
  const kept = (from: number, to: number, offset: number): DiffOp[] =>
    a.slice(from, to).map((text, k) => keep(text, b[offset + k] as string))
  return [
    ...kept(0, start, 0),
    ...middleOps(a.slice(start, endA), b.slice(start, endB), same),
    ...kept(endA, a.length, endB),
  ]
}

function keep(text: string, into: string): DiffOp {
  return text === into ? { op: '=', text } : { op: '=', text, into }
}

function middleOps(a: readonly string[], b: readonly string[], same: Same): DiffOp[] {
  const n = a.length
  const m = b.length
  const out = (list: readonly string[]): DiffOp[] => list.map((text) => ({ op: '-', text }))
  const into = (list: readonly string[]): DiffOp[] => list.map((text) => ({ op: '+', text }))
  if (n === 0 || m === 0 || (n + 1) * (m + 1) > MAX_DIFF_CELLS) return [...out(a), ...into(b)]
  // lcs[i * (m + 1) + j]: the LCS length of a[i..] and b[j..].
  const width = m + 1
  const lcs = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] = same(a[i] as string, b[j] as string)
        ? (lcs[(i + 1) * width + j + 1] as number) + 1
        : Math.max(lcs[(i + 1) * width + j] as number, lcs[i * width + j + 1] as number)
    }
  }
  const ops: DiffOp[] = []
  let removed: DiffOp[] = []
  let added: DiffOp[] = []
  const flush = () => {
    ops.push(...removed, ...added)
    removed = []
    added = []
  }
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && same(a[i] as string, b[j] as string)) {
      flush()
      ops.push(keep(a[i++] as string, b[j++] as string))
    } else if (
      j >= m ||
      (i < n && (lcs[(i + 1) * width + j] as number) >= (lcs[i * width + j + 1] as number))
    ) {
      removed.push({ op: '-', text: a[i++] as string })
    } else {
      added.push({ op: '+', text: b[j++] as string })
    }
  }
  flush()
  return ops
}

/** `text` in lines, each with its line break; no empty last line. */
function linesOf(text: string): string[] {
  return text === '' ? [] : text.split(/(?<=\n)/)
}

/** A line's kind for pairing the lines of a changed run: blank, or with text. */
function kindOf(line: string): string {
  return line.trim() === '' ? 'blank' : 'text'
}

/**
 * The changes that turn `doc` into `next`, as small as a line diff and then a character diff of
 * each changed line make them: a cursor in a token the formatter recased or respaced stays in it.
 * In a run of changed lines, the lines with text pair up in order, and the blank lines the
 * formatter adds or drops go in or out on their own. Positions are `doc`'s.
 */
export function textChanges(doc: Text, next: string): ChangeSpec[] {
  const changes: ChangeSpec[] = []
  const ops = diffSequences(linesOf(doc.toString()), linesOf(next))
  let pos = 0
  for (let k = 0; k < ops.length; ) {
    const op = ops[k] as DiffOp
    if (op.op === '=') {
      pos += op.text.length
      k++
      continue
    }
    const removed: string[] = []
    const added: string[] = []
    while (k < ops.length && (ops[k] as DiffOp).op === '-') removed.push((ops[k++] as DiffOp).text)
    while (k < ops.length && (ops[k] as DiffOp).op === '+') added.push((ops[k++] as DiffOp).text)
    let i = 0
    let j = 0
    for (const step of diffSequences(removed.map(kindOf), added.map(kindOf))) {
      if (step.op === '=') {
        const line = removed[i++] as string
        changes.push(...charChanges(line, added[j++] as string, pos))
        pos += line.length
      } else if (step.op === '-') {
        const line = removed[i++] as string
        changes.push({ from: pos, to: pos + line.length, insert: '' })
        pos += line.length
      } else {
        changes.push({ from: pos, to: pos, insert: added[j++] as string })
      }
    }
  }
  return changes
}

/** The formatter changes the case of words: a letter and its other case are one letter. */
const sameLetter: Same = (a, b) => a === b || a.toLowerCase() === b.toLowerCase()

/**
 * The changes that turn line `a` into line `b`, at `offset`: runs of characters out and in, and a
 * letter whose case changed replaced where it stands.
 */
function charChanges(a: string, b: string, offset: number): ChangeSpec[] {
  const changes: { from: number; to: number; insert: string }[] = []
  let pos = offset
  const change = (to: number, insert: string) => {
    const last = changes.at(-1)
    if (last !== undefined && last.to === pos) {
      last.to = to
      last.insert += insert
    } else {
      changes.push({ from: pos, to, insert })
    }
  }
  for (const { op, text, into } of diffSequences(a.split(''), b.split(''), sameLetter)) {
    if (op === '=' && into === undefined) {
      pos += text.length
    } else if (op === '=') {
      // Its own change, so a cursor on either side of the letter stays on that side.
      changes.push({ from: pos, to: pos + text.length, insert: into ?? text })
      pos += text.length
    } else if (op === '-') {
      change(pos + text.length, '')
      pos += text.length
    } else {
      change(pos, text)
    }
  }
  return changes
}
