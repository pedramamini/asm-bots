/**
 * The debugger's session (`src/features/editor/debug/session.ts`): each move, breakpoints, and step
 * back, checked against battles the engine runs straight through.
 */
import { describe, expect, it } from 'bun:test'
import { assembleOrThrow } from '@asmbots/asm'
import { fighter, loadRoster } from '@asmbots/bots'
import {
  Battle,
  type BattleConfigInput,
  type Bot,
  DEATH_REASONS,
  fnv1a64,
  IP,
  type LoadedBot,
  type ProcRow,
  snapshot,
} from '@asmbots/engine'
import {
  DebugSession,
  type DebugState,
  HISTORY_DEPTH,
  RUN_SNAPSHOT_INTERVAL,
} from '../src/features/editor/debug/session'

/** A bot from source, and its labels. */
function bot(source: string): { loaded: LoadedBot; at: (label: string) => number } {
  const a = assembleOrThrow(source)
  return {
    loaded: { name: a.name, bytes: a.bytes },
    at: (label) => {
      const offset = a.symbols.get(label)
      if (offset === undefined) throw new Error(`no label ${label}`)
      return offset
    },
  }
}

/** A call two deep: `start` calls `sub`, which calls `leaf`. */
const CALLER = bot(`%name "Caller"
start:  call    sub
back:   inc     ax
        jmp     start
sub:    inc     bx
        call    leaf
subret: ret
leaf:   inc     cx
        ret`)

/**
 * At `loop` in iteration k (from 0, in cycle 1 + 3k), ax is k and cx is 18 - k, so
 * `ax == 0x10 && cx < 3` first holds in iteration 16.
 */
const COUNTER = bot(`%name "Counter"
start:  mov     cx, 18
loop:   inc     ax
        dec     cx
        jmp     loop`)

/** Five words with rep stosw, then again. */
const REP = bot(`%name "Rep"
start:  call    .here
.here:  pop     bx
        sub     bx, .here
        lea     di, [bx+buf]
        mov     cx, 5
fill:   rep     stosw
after:  jmp     start
buf:    resw    8`)

/** Each child it starts dies on its first instruction. */
const FORK = bot(`%name "Fork"
start:  spl     child
        inc     ax
        jmp     start
child:  dat`)

/** Runs into its own INT3. */
const TRAP = bot(`%name "Trap"
start:  inc     ax
trap:   int3
        inc     bx`)

const DWARF = fighter('dwarf')
/** The offset of the dwarf's `mov word [di], 0`, the line of its bombs. */
const DWARF_BOMB = (() => {
  const line = loadRoster()
    .get('dwarf')
    ?.assembled.listing.find((l) => l.source.includes('mov     word [di], 0'))
  if (line === undefined) throw new Error('the dwarf has no bomb line')
  return line.address
})()
const IMP = fighter('imp')
const PAPER = fighter('paper')

/** The state of `battle` as a hash: the core, the owners, the queues, the stats, the cycle. */
function hash(battle: Battle): string {
  const s = snapshot(battle)
  const fields: number[] = [s.cycle]
  for (const b of s.bots) {
    const { cycles, writes, peakProcs, deathCycle, deathReason } = b.stats
    fields.push(b.head, b.size, ...b.queue, cycles, writes, peakProcs, deathCycle ?? -1)
    fields.push(deathReason === null ? -1 : DEATH_REASONS.indexOf(deathReason))
  }
  const words = new Uint8Array(new Uint32Array(fields).buffer)
  return fnv1a64(s.core) + fnv1a64(s.owner) + fnv1a64(words)
}

/** The engine's battle after `cycles` cycles, run straight through. */
function straight(bots: readonly LoadedBot[], config: BattleConfigInput, cycles: number): Battle {
  const battle = new Battle(bots, config)
  battle.run(cycles)
  return battle
}

const baseOf = (session: DebugSession, index = 0) => (session.battle.bots[index] as Bot).base

describe('DebugSession: a new session', () => {
  it('follows the front process of the first bot, and has no step back', () => {
    const session = new DebugSession([DWARF, IMP], { seed: 1 })
    const s = session.state
    expect(s.cycle).toBe(0)
    expect(s.stop).toEqual({ kind: 'start' })
    expect(s.selectedProc).toEqual({ bot: 0, row: 0, index: 0 })
    expect(s.ip).toBe(baseOf(session))
    expect(s.regs).toEqual({ ax: 0, bx: 0, cx: 0, dx: 0, si: 0, di: 0, bp: 0, sp: baseOf(session) })
    expect(s.flags).toBe(0x0002)
    expect(s.lastWrites).toEqual([])
    expect(s.breakpoints).toEqual([])
    expect(s.canStepBack).toBe(false)
    expect(session.stepBack()).toBeNull()
  })

  it('throws as a battle does for bots that do not fit', () => {
    expect(() => new DebugSession([])).toThrow(RangeError)
    expect(() => new DebugSession([DWARF, IMP], { minSpacing: 0x8000 })).toThrow('cannot place')
  })
})

describe('DebugSession: step', () => {
  it('runs one instruction of the followed process, and the other bots with it', () => {
    const session = new DebugSession([DWARF, IMP], { seed: 1 })
    for (let k = 1; k <= 20; k++) {
      const s = session.step()
      expect(s.stop).toEqual({ kind: 'step' })
      expect(s.cycle).toBe(k)
      expect(hash(session.battle)).toBe(hash(straight([DWARF, IMP], { seed: 1 }, k)))
    }
  })

  it('waits for the turn of a process behind others in its queue', () => {
    const config = { seed: 1 }
    const session = new DebugSession([DWARF, PAPER], config)
    session.run(400)
    const q = (session.battle.bots[1] as Bot).queue
    expect(q.size).toBeGreaterThanOrEqual(3)
    const row = q.at(2)
    session.select(1, row)
    expect(session.state.selectedProc).toEqual({ bot: 1, row, index: 2 })
    const s = session.step()
    // Third in line: it runs in the third cycle, and runs once.
    expect(s.cycle).toBe(403)
    expect(s.stop).toEqual({ kind: 'step' })
    const oracle = straight([DWARF, PAPER], config, 403)
    const after = (oracle.bots[1] as Bot).queue.rows[row] as ProcRow
    expect(s.ip).toBe(after[IP] as number)
    expect(hash(session.battle)).toBe(hash(oracle))
  })

  it('records the stores of the move', () => {
    const session = new DebugSession([DWARF])
    // The base idiom's call pushes its return address below the base.
    const push = { cycle: 0, bot: 0, addr: baseOf(session) - 2, len: 2 }
    expect(session.step().lastWrites).toEqual([push])
    for (let k = 1; k < 6; k++) expect(session.step().lastWrites).toEqual([])
    // Cycle 6 runs `mov word [di], 0`.
    const di = session.state.regs.di
    expect(session.step().lastWrites).toEqual([{ cycle: 6, bot: 0, addr: di, len: 2 }])
    expect(session.step().lastWrites).toEqual([])
  })

  it('keeps a process that died on its step followed, then follows its bot on', () => {
    const session = new DebugSession([FORK.loaded])
    session.step() // the spl: the child queues ahead of its parent
    const q = (session.battle.bots[0] as Bot).queue
    const child = q.front()
    session.select(0, child)
    const died = session.step()
    const base = baseOf(session)
    expect(died.stop).toEqual({
      kind: 'died',
      bot: 0,
      row: child,
      addr: base + FORK.at('child'),
      reason: 'dat',
    })
    expect(died.selectedProc).toEqual({ bot: 0, row: child, index: -1 })
    expect(died.ip).toBe(base + FORK.at('child'))
    const next = session.step()
    expect(next.stop).toEqual({ kind: 'step' })
    expect(next.selectedProc.row).not.toBe(child)
    expect(next.regs.ax).toBe(1)
  })

  it('runs one cycle once its bot is dead, and nothing once the battle is over', () => {
    const session = new DebugSession([TRAP.loaded, IMP, { ...IMP, name: 'Imp 2' }], { seed: 1 })
    session.step()
    const died = session.step()
    expect(died.stop).toMatchObject({ kind: 'died', reason: 'int3' })
    expect(died.over).toBe(false)
    expect(died.selectedProc).toEqual({ bot: 0, row: 0, index: -1 })
    const dead = session.step()
    expect(dead.stop).toEqual({ kind: 'step' })
    expect(dead.cycle).toBe(3)
    expect(dead.selectedProc).toEqual({ bot: 0, row: 0, index: -1 })
    expect(session.stepOver().cycle).toBe(4)
    expect(session.stepOut().cycle).toBe(5)

    const alone = new DebugSession([TRAP.loaded])
    alone.step()
    expect(alone.step().over).toBe(true)
    const again = alone.step()
    expect(again.stop).toEqual({ kind: 'over' })
    expect(again.cycle).toBe(2)
  })
})

describe('DebugSession: step over and step out', () => {
  it('steps over a call to the instruction after it, the calls inside included', () => {
    const session = new DebugSession([CALLER.loaded])
    const base = baseOf(session)
    const s = session.stepOver()
    expect(s.stop).toEqual({ kind: 'step' })
    // call sub, inc bx, call leaf, inc cx, ret, ret.
    expect(s.cycle).toBe(6)
    expect(s.ip).toBe(base + CALLER.at('back'))
    expect(s.regs).toMatchObject({ ax: 0, bx: 1, cx: 1, sp: base })
  })

  it('steps into a call with step, and over any other instruction as a step', () => {
    const session = new DebugSession([CALLER.loaded])
    const base = baseOf(session)
    expect(session.step().ip).toBe(base + CALLER.at('sub'))
    const s = session.stepOver()
    expect(s.cycle).toBe(2)
    expect(s.ip).toBe(base + CALLER.at('sub') + 1)
  })

  it('steps out of the function it is in, not out of one it calls', () => {
    const session = new DebugSession([CALLER.loaded])
    const base = baseOf(session)
    session.step() // into sub
    const out = session.stepOut()
    expect(out.stop).toEqual({ kind: 'step' })
    expect(out.cycle).toBe(6)
    expect(out.ip).toBe(base + CALLER.at('back'))
    expect(out.regs.sp).toBe(base)

    session.reset()
    session.step() // into sub
    session.step() // inc bx
    expect(session.step().ip).toBe(base + CALLER.at('leaf'))
    const fromLeaf = session.stepOut()
    expect(fromLeaf.cycle).toBe(5)
    expect(fromLeaf.ip).toBe(base + CALLER.at('subret'))
  })

  it("steps over the base idiom's call, which returns to the next line at once", () => {
    const session = new DebugSession([DWARF])
    const s = session.stepOver()
    expect(s.cycle).toBe(1)
    expect(s.ip).toBe(baseOf(session) + 3)
  })

  it('steps over a REP string instruction to its end', () => {
    const session = new DebugSession([REP.loaded])
    const base = baseOf(session)
    session.runToCursor(base + REP.at('fill'))
    expect(session.state.regs.cx).toBe(5)
    const s = session.stepOver()
    expect(s.cycle).toBe(session.state.cycle)
    expect(s.ip).toBe(base + REP.at('after'))
    expect(s.regs.cx).toBe(0)
    expect(s.regs.di).toBe(base + REP.at('buf') + 10)
    expect(s.lastWrites.map((w) => w.addr)).toEqual(
      [0, 2, 4, 6, 8].map((k) => base + REP.at('buf') + k),
    )
  })

  it('stops a step over when the process dies in the call', () => {
    const session = new DebugSession([
      bot(`%name "Dies"
start:  call    boom
        nop
boom:   dat`).loaded,
    ])
    const s = session.stepOver()
    expect(s.stop).toMatchObject({ kind: 'died', reason: 'dat' })
    expect(s.cycle).toBe(2)
  })
})

describe('DebugSession: runs', () => {
  it('runs n cycles', () => {
    const session = new DebugSession([DWARF, IMP], { seed: 1 })
    const s = session.run(1000)
    expect(s.stop).toEqual({ kind: 'cycles' })
    expect(s.cycle).toBe(1000)
    expect(hash(session.battle)).toBe(hash(straight([DWARF, IMP], { seed: 1 }, 1000)))
    expect(() => session.run(-1)).toThrow(RangeError)
    expect(() => session.run(1.5)).toThrow(RangeError)
  })

  it('runs to the cursor, and from there to its next pass', () => {
    const session = new DebugSession([DWARF])
    const base = baseOf(session)
    // call, pop, sub, mov di, mov cx, sub di: then `mov word [di], 0`.
    const bomb = base + DWARF_BOMB
    const s = session.runToCursor(bomb)
    expect(s.stop).toEqual({ kind: 'cursor', bot: 0, row: 0, addr: bomb })
    expect(s.cycle).toBe(6)
    expect(s.ip).toBe(bomb)
    expect(session.runToCursor(bomb).cycle).toBe(9)
    expect(() => session.runToCursor(0x10000)).toThrow(RangeError)
  })

  it('runs until a bot dies', () => {
    const config = { seed: 2 }
    const oracle = new Battle([DWARF, IMP], config)
    oracle.run()
    const death = (oracle.bots[1] as Bot).stats.deathCycle as number
    const session = new DebugSession([DWARF, IMP], config)
    const s = session.runUntilDeath(1)
    expect(s.stop).toEqual({ kind: 'death', bot: 1 })
    expect(s.cycle).toBe(death + 1)
    expect(s.over).toBe(true)
    expect(session.runUntilDeath(1).cycle).toBe(death + 1)
    expect(() => session.runUntilDeath(2)).toThrow(RangeError)
  })

  it('stops at the end of the battle', () => {
    const session = new DebugSession([DWARF, IMP], { seed: 2, maxCycles: 500 })
    const s = session.run(Number.POSITIVE_INFINITY)
    expect(s.stop).toEqual({ kind: 'over' })
    expect(s.cycle).toBe(500)
    expect(session.run(10).cycle).toBe(500)
  })

  it('follows the next process of a bot whose followed process died in a run', () => {
    const session = new DebugSession([FORK.loaded])
    session.step()
    session.select(0, (session.battle.bots[0] as Bot).queue.front())
    const s = session.run(10)
    expect(s.stop).toEqual({ kind: 'cycles' })
    expect(s.selectedProc.index).toBe(0)
  })
})

describe('DebugSession: breakpoints', () => {
  it('stops at the cycle a conditional breakpoint first holds', () => {
    const config = { seed: 3 }
    const session = new DebugSession([COUNTER.loaded, IMP], config)
    const loop = baseOf(session) + COUNTER.at('loop')
    session.setBreakpoint(loop, { condition: 'ax == 0x10 && cx < 3' })
    const s = session.run(Number.POSITIVE_INFINITY)
    // `mov cx` in cycle 0, then 3 instructions an iteration: iteration 16 starts in cycle 49.
    expect(s.stop).toEqual({ kind: 'breakpoint', bot: 0, row: 0, addr: loop })
    expect(s.cycle).toBe(49)
    expect(s.regs).toMatchObject({ ax: 16, cx: 2 })
    expect(s.breakpoints).toEqual([
      { addr: loop, enabled: true, condition: 'ax == 0x10 && cx < 3', hits: 1 },
    ])
    expect(hash(session.battle)).toBe(hash(straight([COUNTER.loaded, IMP], config, 49)))
  })

  it('runs the instruction it stands on, and stops at the next pass', () => {
    const session = new DebugSession([COUNTER.loaded])
    const loop = baseOf(session) + COUNTER.at('loop')
    session.setBreakpoint(loop)
    expect(session.run(1000).cycle).toBe(1)
    expect(session.run(1000).cycle).toBe(4)
    expect(session.step().cycle).toBe(5)
    expect(session.state.breakpoints[0]?.hits).toBe(2)
  })

  it('never writes the core: the battle is the one the engine runs', () => {
    const session = new DebugSession([DWARF, IMP], { seed: 1 })
    for (let a = 0; a < 0x10000; a += 251) session.setBreakpoint(a, { enabled: false })
    const bomb = baseOf(session) + DWARF_BOMB
    // The lap counter starts at 0x3FFA and counts down once a bomb: the 12th bomb.
    session.setBreakpoint(bomb, { condition: 'cx < 0x3FF0' })
    const s = session.run(100_000)
    expect(s.stop).toMatchObject({ kind: 'breakpoint', addr: bomb })
    expect(s.cycle).toBe(6 + 3 * 11)
    expect(s.regs.cx).toBe(0x3fef)
    expect(hash(session.battle)).toBe(hash(straight([DWARF, IMP], { seed: 1 }, s.cycle)))
  })

  it('does not stop at a disabled one, and follows the process that hit one', () => {
    const config = { seed: 1 }
    const session = new DebugSession([DWARF, IMP], config)
    const imp = (session.battle.bots[1] as Bot).base
    session.setBreakpoint(imp, { enabled: false })
    expect(session.run(10).stop).toEqual({ kind: 'cycles' })
    session.reset()
    session.setBreakpoint(imp + 3, { enabled: true })
    const s = session.run(100)
    expect(s.stop).toEqual({ kind: 'breakpoint', bot: 1, row: 0, addr: imp + 3 })
    expect(s.selectedProc).toEqual({ bot: 1, row: 0, index: 0 })
    expect(s.ip).toBe(imp + 3)
  })

  it('names the process that runs first when two stop in one cycle, and counts both', () => {
    const twin = { ...COUNTER.loaded, name: 'Counter 2' }
    const session = new DebugSession([COUNTER.loaded, twin], { seed: 1 })
    const loops = [0, 1].map((k) => baseOf(session, k) + COUNTER.at('loop'))
    for (const loop of loops) session.setBreakpoint(loop)
    // Cycle c starts with bot c mod 2.
    const first = session.run(100)
    expect(first.cycle).toBe(1)
    expect(first.stop).toMatchObject({ kind: 'breakpoint', bot: 1, addr: loops[1] })
    expect(first.selectedProc.bot).toBe(1)
    const second = session.run(100)
    expect(second.cycle).toBe(4)
    expect(second.stop).toMatchObject({ kind: 'breakpoint', bot: 0, addr: loops[0] })
    expect(second.breakpoints.map((b) => b.hits)).toEqual([2, 2])
  })

  it('survives reset, its hits back at 0', () => {
    const session = new DebugSession([COUNTER.loaded])
    const loop = baseOf(session) + COUNTER.at('loop')
    session.setBreakpoint(loop, { condition: 'ax == 0x10 && cx < 3' })
    expect(session.run(Number.POSITIVE_INFINITY).cycle).toBe(49)
    const reset = session.reset()
    expect(reset.cycle).toBe(0)
    expect(reset.stop).toEqual({ kind: 'start' })
    expect(reset.canStepBack).toBe(false)
    expect(reset.breakpoints).toEqual([
      { addr: loop, enabled: true, condition: 'ax == 0x10 && cx < 3', hits: 0 },
    ])
    const again = session.run(Number.POSITIVE_INFINITY)
    expect(again.stop).toMatchObject({ kind: 'breakpoint', addr: loop })
    expect(again.cycle).toBe(49)
    expect(again.breakpoints[0]?.hits).toBe(1)
  })

  it('stops when a condition cannot be evaluated, and says why', () => {
    const session = new DebugSession([COUNTER.loaded])
    const loop = baseOf(session) + COUNTER.at('loop')
    // Words wrap: 100 / -3 is 0xFFDF, so this is false until ax is 3.
    session.setBreakpoint(loop, { condition: 'cx != 0 && 100 / (ax - 3) == 7' })
    const s = session.run(1000)
    expect(s.stop).toEqual({
      kind: 'breakpoint',
      bot: 0,
      row: 0,
      addr: loop,
      error: 'division by zero',
    })
    expect(s.regs.ax).toBe(3)
  })

  it('sets, changes, toggles, and removes, sorted by address', () => {
    const session = new DebugSession([DWARF])
    const seen: DebugState[] = []
    session.subscribe((s) => seen.push(s))
    expect(session.setBreakpoint(0x200)).toEqual({
      addr: 0x200,
      enabled: true,
      condition: '',
      hits: 0,
    })
    session.setBreakpoint(0x100, { condition: ' AX == 1 ' })
    session.setBreakpoint(0x100, { enabled: false })
    expect(session.state.breakpoints).toEqual([
      { addr: 0x100, enabled: false, condition: ' AX == 1 ', hits: 0 },
      { addr: 0x200, enabled: true, condition: '', hits: 0 },
    ])
    session.setBreakpoint(0x100, { condition: '' })
    expect(session.state.breakpoints[0]?.condition).toBe('')
    expect(session.toggleBreakpoint(0x200)).toBe(false)
    expect(session.toggleBreakpoint(0x300)).toBe(true)
    expect(session.removeBreakpoint(0x100)).toBe(true)
    expect(session.removeBreakpoint(0x100)).toBe(false)
    expect(session.state.breakpoints.map((b) => b.addr)).toEqual([0x300])
    expect(seen).toHaveLength(7)
    expect(() => session.setBreakpoint(0x10000)).toThrow(RangeError)
    expect(() => session.setBreakpoint(0x10, { condition: 'ax = 1' })).toThrow(
      'setBreakpoint: column 4: `=` alone: compare with `==`',
    )
    expect(() => session.setBreakpoint(0x10, { condition: 'ac == 1' })).toThrow(
      '`ac` is not a register or a flag',
    )
  })
})

describe('DebugSession: INT3', () => {
  it("stops before a process runs its own bot's INT3, and a move from there runs it", () => {
    const session = new DebugSession([TRAP.loaded])
    const trap = baseOf(session) + TRAP.at('trap')
    const s = session.run(10)
    expect(s.stop).toEqual({ kind: 'int3', bot: 0, row: 0, addr: trap })
    expect(s.cycle).toBe(1)
    const died = session.run(10)
    expect(died.stop).toEqual({ kind: 'over' })
    expect(died.selectedProc.index).toBe(-1)
    expect(died.ip).toBe(trap)
    expect((session.battle.bots[0] as Bot).stats.deathReason).toBe('int3')
  })

  it('does not stop at an INT3 another bot wrote: that is a bomb', () => {
    /** The counter at `loop` with an INT3 on its next instruction, owned by `owner`. */
    const bombed = (owner: number) => {
      const session = new DebugSession([COUNTER.loaded, IMP], { seed: 3 })
      const loop = baseOf(session) + COUNTER.at('loop')
      session.runToCursor(loop)
      session.battle.core.bytes[loop + 1] = 0xcc
      session.battle.core.owner[loop + 1] = owner
      return { session, at: loop + 1 }
    }
    const bomb = bombed(2)
    expect(bomb.session.run(10).stop).toEqual({ kind: 'over' })
    expect((bomb.session.battle.bots[0] as Bot).stats.deathReason).toBe('int3')
    const own = bombed(1)
    expect(own.session.run(10).stop).toEqual({ kind: 'int3', bot: 0, row: 0, addr: own.at })
  })
})

describe('DebugSession: step back', () => {
  it('restores each of the last 256 of 300 steps exactly', () => {
    const config = { seed: 1 }
    const session = new DebugSession([DWARF, IMP], config)
    const hashes = [hash(session.battle)]
    for (let k = 0; k < 300; k++) {
      session.step()
      hashes.push(hash(session.battle))
    }
    expect(hashes[300]).toBe(hash(straight([DWARF, IMP], config, 300)))
    for (let k = 299; k >= 300 - HISTORY_DEPTH; k--) {
      const s = session.stepBack()
      expect(s?.stop).toEqual({ kind: 'back' })
      expect([k, hash(session.battle)]).toEqual([k, hashes[k] as string])
    }
    expect(session.state.canStepBack).toBe(false)
    expect(session.stepBack()).toBeNull()
    expect(session.state.cycle).toBe(300 - HISTORY_DEPTH)
  })

  it('undoes a whole step over, and a step of a process that waited', () => {
    const session = new DebugSession([CALLER.loaded])
    const before = hash(session.battle)
    session.stepOver()
    expect(session.stepBack()?.cycle).toBe(0)
    expect(hash(session.battle)).toBe(before)

    const paper = new DebugSession([DWARF, PAPER], { seed: 1 })
    paper.run(400)
    const q = (paper.battle.bots[1] as Bot).queue
    paper.select(1, q.at(2))
    const at400 = hash(paper.battle)
    expect(paper.step().cycle).toBe(403)
    expect(paper.stepBack()?.cycle).toBe(400)
    expect(hash(paper.battle)).toBe(at400)
  })

  it('goes back through a run a cycle at a time, across its snapshots', () => {
    const config = { seed: 1 }
    const bots = [DWARF, PAPER]
    const session = new DebugSession(bots, config)
    // Runs in pieces, as the transport's run does: one snapshot at the start, then every 64.
    for (let k = 0; k < 10; k++) session.run(20)
    expect(session.state.cycle).toBe(200)
    const oracle = new Battle(bots, config)
    const hashes = [hash(oracle)]
    for (let c = 1; c <= 200; c++) {
      oracle.step()
      hashes.push(hash(oracle))
    }
    for (let c = 199; c >= 0; c--) {
      expect(session.stepBack()?.cycle).toBe(c)
      expect([c, hash(session.battle)]).toEqual([c, hashes[c] as string])
    }
    expect(session.stepBack()).toBeNull()
    expect(RUN_SNAPSHOT_INTERVAL).toBe(64)
  })

  it('goes back through steps and runs mixed, then forward the same way again', () => {
    const config = { seed: 1 }
    const bots = [DWARF, IMP]
    const session = new DebugSession(bots, config)
    const bomb = baseOf(session) + DWARF_BOMB
    const path: number[] = []
    const moves: (() => DebugState)[] = [
      () => session.step(),
      () => session.run(70),
      () => session.stepOver(),
      () => session.runToCursor(bomb),
      () => session.step(),
      () => session.run(3),
    ]
    for (const move of moves) path.push(move().cycle)
    expect(path).toEqual([1, 71, 72, 75, 76, 79])
    const backs: number[] = []
    for (let s = session.stepBack(); s !== null; s = session.stepBack()) {
      backs.push(s.cycle)
      expect(hash(session.battle)).toBe(hash(straight(bots, config, s.cycle)))
    }
    const run = (from: number, to: number) =>
      Array.from({ length: to - from }, (_, k) => to - 1 - k)
    expect(backs).toEqual([...run(76, 79), 75, ...run(72, 75), 71, ...run(1, 71), 0])
    for (const move of moves) move()
    expect(session.state.cycle).toBe(79)
    expect(hash(session.battle)).toBe(hash(straight(bots, config, 79)))
  })

  it('keeps the followed process when it is still there, else follows its bot', () => {
    const session = new DebugSession([DWARF, PAPER], { seed: 1 })
    session.run(400)
    const q = (session.battle.bots[1] as Bot).queue
    const last = q.at(q.size - 1)
    session.select(1, last)
    session.step()
    session.stepBack()
    expect(session.state.selectedProc).toMatchObject({ bot: 1, row: last })
    session.reset()
    expect(session.state.selectedProc).toEqual({ bot: 1, row: 0, index: 0 })
    expect(() => session.select(1, 5)).toThrow(RangeError)
    expect(() => session.select(3)).toThrow(RangeError)
  })
})

describe('DebugSession: listeners', () => {
  it('get each new state once, until they unsubscribe', () => {
    const session = new DebugSession([DWARF, IMP], { seed: 1 })
    const seen: DebugState[] = []
    const stop = session.subscribe((s) => seen.push(s))
    session.step()
    session.run(5)
    session.stepBack()
    session.select(1)
    session.reset()
    expect(seen.map((s) => s.stop.kind)).toEqual(['step', 'cycles', 'back', 'back', 'start'])
    expect(seen.at(-1)).toBe(session.state)
    stop()
    session.step()
    expect(seen).toHaveLength(5)
  })
})
