import { describe, expect, it } from 'bun:test'
import { AX, Battle, type Bot, CX, IP, type ProcRow, SP } from '@asmbots/engine'
import { loadRoster } from '../src/roster'
import { alone, bytesAt, EventLog, fighter, symbolOf } from './fight'

/** The test bot `slug` alone in the core, placed by seed 1, before its first cycle. */
function start(slug: string, maxProcesses?: number) {
  const events = new EventLog()
  const battle = new Battle([fighter(slug)], { seed: 1, maxProcesses }, events)
  return { battle, bot: battle.bots[0] as Bot, events }
}

/** The registers of the process `i` places behind the front of `bot`'s queue. */
const proc = (bot: Bot, i = 0) => bot.queue.rows[bot.queue.at(i)] as ProcRow

/** `addr` as an offset from the base of `bot`. */
const offset = (bot: Bot, addr: number) => (addr - bot.base) & 0xffff

/** `jmp $` as a little-endian word: EB FE. */
const JMP_SELF = 0xfeeb

describe('roster: test bots', () => {
  it('halt dies in cycle 0, on its hlt', () => {
    const { bot } = alone('halt', 100)
    const { deathCycle, deathReason, writes } = bot.stats
    expect({ alive: bot.alive, deathCycle, deathReason, writes }).toEqual({
      alive: false,
      deathCycle: 0,
      deathReason: 'hlt',
      writes: 0,
    })
  })

  it('spin lives to the cycle cap and writes nothing', () => {
    const { battle, bot } = alone('spin', Number.POSITIVE_INFINITY)
    expect({ cycles: battle.cycle, alive: bot.alive, writes: bot.stats.writes }).toEqual({
      cycles: battle.config.maxCycles,
      alive: true,
      writes: 0,
    })
  })

  it('count has ax = 100 after 298 cycles, one instruction a cycle, and holds it', () => {
    const { battle, bot } = start('count')
    battle.run(297)
    expect(proc(bot)[AX]).toBe(99)
    battle.run(1)
    expect(proc(bot)[AX]).toBe(100)
    battle.run(400 - 298)
    const ip = proc(bot)[IP] as number
    expect({ ax: proc(bot)[AX], spins: battle.core.read16(ip) === JMP_SELF }).toEqual({
      ax: 100,
      spins: true,
    })
    battle.run()
    expect({ alive: bot.alive, ax: proc(bot)[AX], ip: proc(bot)[IP] }).toEqual({
      alive: true,
      ax: 100,
      ip,
    })
  })

  it('spl-storm fills the cap of 64 processes in 101 cycles, with 63 spawns, and holds it', () => {
    const { battle, bot, events } = start('spl-storm')
    battle.run(100)
    expect(bot.queue.size).toBe(63)
    battle.run(1)
    expect(bot.queue.size).toBe(64)
    battle.run(10_000)
    const got = { procs: bot.queue.size, peak: bot.stats.peakProcs, spawns: events.spawns.length }
    expect({ ...got, deaths: events.deaths.length }).toEqual({
      procs: 64,
      peak: 64,
      spawns: 63,
      deaths: 0,
    })
  })

  it('spl-storm stops at the cap the config sets', () => {
    const { battle, bot } = start('spl-storm', 5)
    battle.run(1000)
    expect({ procs: bot.queue.size, peak: bot.stats.peakProcs }).toEqual({ procs: 5, peak: 5 })
  })

  it('stack-walk pushes its words down from its base, and writes nothing else', () => {
    const words = symbolOf('stack-walk', 'WORDS')
    const { battle, bot } = alone('stack-walk', 2000)
    // cx counts down from WORDS, so the word under the base is WORDS and the lowest is 1.
    const stack = Array.from({ length: words }, (_, k) =>
      battle.core.read16(bot.base - 2 * (k + 1)),
    )
    expect(stack).toEqual(Array.from({ length: words }, (_, k) => words - k))
    expect({
      alive: bot.alive,
      sp: offset(bot, proc(bot)[SP] as number),
      image: bytesAt(battle, bot.base, bot.size),
      footprint: battle.result().bots[0]?.footprint,
    }).toEqual({
      alive: true,
      sp: 0x10000 - 2 * words,
      image: [...fighter('stack-walk').bytes],
      footprint: bot.size + 2 * words,
    })
  })

  it('rep-copy runs its rep movsw 256 cycles on the prefix, then ip is past it', () => {
    const copy = symbolOf('rep-copy', 'copy')
    const words = symbolOf('rep-copy', 'WORDS')
    const { battle, bot } = start('rep-copy')
    const ip = () => offset(bot, proc(bot)[IP] as number)
    while (ip() !== copy) battle.step()
    const first = battle.cycle
    const cx: number[] = []
    while (ip() === copy) {
      battle.step()
      cx.push(proc(bot)[CX] as number)
    }
    // One word a cycle: cx counts down to 0, and ip stays on the prefix until it is 0.
    expect({ cycles: battle.cycle - first, ip: ip(), cx }).toEqual({
      cycles: words,
      ip: copy + 2,
      cx: Array.from({ length: words }, (_, k) => words - 1 - k),
    })
  })

  it('rep-copy copies the 512 bytes from its base to AWAY bytes on', () => {
    const away = symbolOf('rep-copy', 'AWAY')
    const bytes = 2 * symbolOf('rep-copy', 'WORDS')
    const { battle, bot } = alone('rep-copy', 1000)
    const from = bytesAt(battle, bot.base, bytes)
    expect(from.slice(0, bot.size)).toEqual([...fighter('rep-copy').bytes])
    expect(bytesAt(battle, bot.base + away, bytes)).toEqual(from)
  })

  it('div-zero dies in cycle 1, on its div, with the reason div', () => {
    const { battle, bot, events } = start('div-zero')
    battle.run()
    const [death] = events.deaths
    expect({ ...death, div: battle.core.read16(death?.addr ?? 0) }).toEqual({
      cycle: 1,
      bot: 0,
      addr: (bot.base + 2) & 0xffff,
      reason: 'div',
      div: 0xf1f7, // div cx: F7 F1
    })
    expect(bot.stats.deathReason).toBe('div')
  })

  describe('misalign', () => {
    const dies = symbolOf('misalign', 'dies')
    const lives = symbolOf('misalign', 'lives')

    it('runs dies from its second byte: inc ax, then an undefined opcode that kills', () => {
      const { battle, bot, events } = start('misalign')
      // Cycles 0 to 5: spl, the child's jmp $, jmp, jmp $, inc ax, jmp $.
      battle.run(6)
      const at = [proc(bot, 0), proc(bot, 1)].map((row) => ({
        ip: offset(bot, row[IP] as number),
        ax: row[AX],
      }))
      expect(at).toContainEqual({ ip: dies + 2, ax: 1 })
      battle.run(1)
      expect(events.deaths).toEqual([
        { cycle: 6, bot: 0, addr: (bot.base + dies + 2) & 0xffff, reason: 'undefined' },
      ])
    })

    it('runs lives from its second byte: jmp $, forever', () => {
      const { battle, bot } = alone('misalign', Number.POSITIVE_INFINITY)
      expect({
        alive: bot.alive,
        procs: bot.queue.size,
        ip: offset(bot, proc(bot)[IP] as number),
      }).toEqual({ alive: true, procs: 1, ip: lives + 1 })
      expect(battle.cycle).toBe(battle.config.maxCycles)
    })

    it('lands where its listing shows no instruction', () => {
      const listing = loadRoster().get('misalign')?.assembled.listing ?? []
      const starts = listing.filter((l) => l.bytes.length > 0).map((l) => l.address)
      expect(starts).toContain(dies)
      expect(starts).toContain(lives)
      for (const inside of [dies + 1, dies + 2, lives + 1]) expect(starts).not.toContain(inside)
    })
  })
})
