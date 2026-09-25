/**
 * What goes into a debug session (PRODUCT_SPEC §3): the bot in the editor, then its opponents,
 * and the breakpoints of the session before it. A new assemble or a new setup loads a new
 * session; a breakpoint in the bot's own bytes follows its source line there, as an editor's
 * breakpoints do, and one elsewhere in the core keeps its address.
 */
import type { Assembled } from '@asmbots/asm'
import type { LoadedBot } from '@asmbots/engine'
import type { AssembledBot, CatalogBot } from '../../arena/setup/bots'
import type { Breakpoint } from './session'

/** The battle's bots: the editor's first, then the opponents, a repeated name numbered. */
export function debugBots(mine: Assembled, opponents: readonly CatalogBot[]): LoadedBot[] {
  const taken = new Map<string, number>()
  const bot = (assembled: AssembledBot, name: string): LoadedBot => {
    const n = (taken.get(name) ?? 0) + 1
    taken.set(name, n)
    const { author, strategy, version } = assembled
    return {
      name: n === 1 ? name : `${name} ${n}`,
      bytes: assembled.bytes,
      meta: { author, strategy, version },
    }
  }
  return [
    bot(mine, mine.name === '' ? 'my bot' : mine.name),
    ...opponents.map((o) => bot(o.assembled, o.name)),
  ]
}

/** How `carryBreakpoints` finds lines: the old session's, and the new one's. */
export interface LineMaps {
  /** The line whose bytes held `addr` in the old session, as the editor has it now. */
  readonly lineOf: (addr: number) => { readonly lineNo: number; readonly offset: number } | null
  /** Whether `addr` was one of the old bot's bytes. */
  readonly inOld: (addr: number) => boolean
  /** Line `lineNo`'s bytes in the new session; null for a line with none. */
  readonly lineBytes: (lineNo: number) => { readonly addr: number; readonly length: number } | null
}

/**
 * `breakpoints` of the old session, as the new one takes them. One in the old bot's bytes goes
 * to the same place of its line's bytes (the line's first byte, if the line is shorter now), or
 * goes away with its line; one elsewhere keeps its address. Two that land on one address make one.
 */
export function carryBreakpoints(breakpoints: readonly Breakpoint[], maps: LineMaps): Breakpoint[] {
  const out = new Map<number, Breakpoint>()
  for (const bp of breakpoints) {
    let addr: number | null = bp.addr
    if (maps.inOld(bp.addr)) {
      const at = maps.lineOf(bp.addr)
      const bytes = at === null ? null : maps.lineBytes(at.lineNo)
      addr =
        at === null || bytes === null
          ? null
          : (bytes.addr + (at.offset < bytes.length ? at.offset : 0)) & 0xffff
    }
    if (addr !== null && !out.has(addr)) out.set(addr, { ...bp, addr, hits: 0 })
  }
  return [...out.values()]
}
