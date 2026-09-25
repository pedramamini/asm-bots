import { describe, expect, it } from 'bun:test'
import {
  CoreDump,
  DUMP_BOTS,
  EMPTY,
  LOAD_MS,
  NOISE,
  REBOOT_MS,
  RUN_MS,
  TICK_MS,
  ZERO_MS,
} from '../src/app/boot/core-dump'

/** Runs `dump` to `ms` in 16 ms frames, as a display would. */
function runTo(dump: CoreDump, ms: number): void {
  while (dump.time < ms) dump.advance(Math.min(16, ms - dump.time))
}

const imp = (dump: CoreDump) => {
  const index = DUMP_BOTS.findIndex((bot) => bot.kind === 'imp')
  return { index, bot: dump.bots[index] }
}

describe('the boot core dump', () => {
  it('powers on as noise that no one owns', () => {
    const dump = new CoreDump(16, 8, 1)
    expect([...dump.owner].every((owner) => owner === NOISE)).toBe(true)
    expect(new Set(dump.bytes).size).toBeGreaterThan(20)
  })

  it('the sweep zeroes the core row by row, and it is all zero by ZERO_MS', () => {
    const dump = new CoreDump(16, 8, 1)
    runTo(dump, ZERO_MS / 2)
    expect(dump.zeroed).toBe(4)
    expect(dump.owner[3 * 16]).toBe(EMPTY)
    expect(dump.owner[5 * 16]).toBe(NOISE)
    runTo(dump, ZERO_MS)
    expect(dump.zeroed).toBe(8)
    expect([...dump.bytes].every((byte) => byte === 0)).toBe(true)
  })

  it('loads each bot at LOAD_MS: its code, in its own hue, at an address of its own', () => {
    const dump = new CoreDump(32, 16, 7)
    runTo(dump, LOAD_MS - 16)
    expect(dump.bots).toHaveLength(0)
    runTo(dump, LOAD_MS)
    expect(dump.bots.map((bot) => bot.kind)).toEqual(DUMP_BOTS.map((bot) => bot.kind))
    expect(new Set(dump.bots.map((bot) => bot.hue)).size).toBe(DUMP_BOTS.length)
    dump.bots.forEach((bot, index) => {
      const code = DUMP_BOTS[index]?.code ?? []
      const bytes = [...dump.bytes.slice(bot.base, bot.base + code.length)]
      expect(bytes).toEqual([...code])
      expect([...dump.owner.slice(bot.base, bot.base + code.length)]).toEqual(code.map(() => index))
    })
  })

  it('runs from RUN_MS: the imp copies `A5 90` a word on each tick and walks into it', () => {
    const dump = new CoreDump(32, 16, 7)
    runTo(dump, RUN_MS)
    const { index, bot } = imp(dump)
    if (bot === undefined) throw new Error('no imp')
    const start = bot.ip
    runTo(dump, RUN_MS + 3 * TICK_MS)
    const ticks = bot.ticks
    expect(ticks).toBeGreaterThanOrEqual(3)
    expect(bot.ip).toBe((start + 2 * ticks) % dump.size)
    for (let k = 1; k <= ticks; k++) {
      const at = (start + 2 * k) % dump.size
      expect([dump.bytes[at], dump.bytes[at + 1]]).toEqual([0xa5, 0x90])
      expect(dump.owner[at]).toBe(index)
    }
  })

  it('the dwarf bombs every 4th byte, going back, with zeros it owns', () => {
    const dump = new CoreDump(32, 16, 7)
    runTo(dump, RUN_MS + 5 * TICK_MS)
    const index = DUMP_BOTS.findIndex((bot) => bot.kind === 'dwarf')
    const dwarf = dump.bots[index]
    if (dwarf === undefined) throw new Error('no dwarf')
    for (let k = 1; k <= dwarf.ticks; k++) {
      const at = (((dwarf.base - 4 * k) % dump.size) + dump.size) % dump.size
      expect(dump.bytes[at]).toBe(0)
      // A later write (the imp, the stone) may land on a bomb; most stay the dwarf's.
      if (dump.owner[at] !== index) expect(dump.owner[at]).not.toBe(EMPTY)
    }
  })

  it('reboots at REBOOT_MS: the sweep comes again and the bots load again', () => {
    const dump = new CoreDump(16, 8, 3)
    runTo(dump, REBOOT_MS - 16)
    expect(dump.bots).toHaveLength(DUMP_BOTS.length)
    dump.advance(16)
    expect(dump.time).toBe(0)
    expect(dump.bots).toHaveLength(0)
    expect(dump.zeroed).toBe(0)
    runTo(dump, LOAD_MS)
    expect(dump.bots).toHaveLength(DUMP_BOTS.length)
  })

  it('takes at most 100 ms a call: a tab that comes back does not replay what it missed', () => {
    const dump = new CoreDump(16, 8, 3)
    dump.advance(60_000)
    expect(dump.time).toBe(100)
  })

  it('settle: a still of the bots running, no glow left', () => {
    const dump = new CoreDump(16, 8, 3)
    dump.settle()
    expect(dump.running).toBe(true)
    expect([...dump.heat].every((heat) => heat === 0)).toBe(true)
  })

  it('reports each changed cell once, then none until the next change', () => {
    const dump = new CoreDump(16, 8, 3)
    runTo(dump, 300)
    const dirty = dump.takeDirty()
    expect(dirty.length).toBeGreaterThan(0)
    expect(new Set(dirty).size).toBe(dirty.length)
    expect(dump.takeDirty()).toEqual([])
  })

  it('the same seed draws the same boot', () => {
    const a = new CoreDump(24, 12, 42)
    const b = new CoreDump(24, 12, 42)
    runTo(a, RUN_MS + 20 * TICK_MS)
    runTo(b, RUN_MS + 20 * TICK_MS)
    expect([...a.bytes]).toEqual([...b.bytes])
    expect(a.ips()).toEqual(b.ips())
  })
})
