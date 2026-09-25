import { disassemble } from '@asmbots/asm'
import { type Battle, IP, type ProcRow } from '@asmbots/engine'
import { cx, HueSwatch, hexAddress, Panel } from '@asmbots/ui'
import { useEffect, useRef, useState } from 'react'
import { useMotionReduced } from '../../../store/settings'
import type { DebugState } from './session'

export interface ProcessesPanelProps {
  state: DebugState | null
  /** The session's battle as the state left it. */
  battle: Battle | null
  names: readonly string[]
  /** The debugged bot's labels by address: a jump to one reads as its name. */
  labels?: ReadonlyMap<number, string> | undefined
  /** Follows process `row` of `bot`. */
  onSelect: (bot: number, row: number) => void
  className?: string | undefined
}

/** The most processes a bot lists; the rest are a count. */
export const MAX_LISTED = 16
/** How long a dead process stays in the list, fading, ms. */
const DEATH_MS = 600
/** The longest instruction, in bytes (ISA §7). */
const MAX_LENGTH = 6

/** A process as the list shows it. */
interface Listed {
  /** `bot:row`: a process keeps its row from its spawn to its death. */
  readonly key: string
  readonly bot: number
  readonly row: number
  /** Its place in the queue: 0 runs in the bot's next turn. */
  readonly index: number
  readonly ip: number
}

/** The instruction at `ip`, as the disassembler writes it. */
function textAt(bytes: Uint8Array, ip: number, labels?: ReadonlyMap<number, string>): string {
  const own = new Uint8Array(MAX_LENGTH)
  for (let k = 0; k < MAX_LENGTH; k++) own[k] = bytes[(ip + k) & 0xffff] as number
  return disassemble(own, ip, { symbols: labels })[0]?.text ?? ''
}

/** Every live process of each bot, front first. */
function processes(battle: Battle | null): Listed[][] {
  if (battle === null) return []
  return battle.bots.map((bot) => {
    const q = bot.queue
    const out: Listed[] = []
    for (let i = 0; i < q.size; i++) {
      const row = q.at(i)
      const ip = (q.rows[row] as ProcRow)[IP] as number
      out.push({ key: `${bot.index}:${row}`, bot: bot.index, row, index: i, ip })
    }
    return out
  })
}

/**
 * The Processes panel (PRODUCT_SPEC §3): each bot's queue, the process that runs in its next turn
 * first (`▸`), `MAX_LISTED` of each. The followed process is accent; a click follows another. A
 * process the last move started flashes in, and one that died fades out, where motion is on.
 */
export function ProcessesPanel({
  state,
  battle,
  names,
  labels,
  onSelect,
  className,
}: ProcessesPanelProps) {
  const reduced = useMotionReduced()
  const all = processes(battle)
  const cycle = state?.cycle ?? 0
  // The processes as of the last state, to tell which the next one started and which died.
  const seen = useRef<{ cycle: number; battle: Battle | null; keys: Map<string, Listed> }>({
    cycle,
    battle,
    keys: new Map(all.flat().map((p) => [p.key, p])),
  })
  const [born, setBorn] = useState<ReadonlySet<string>>(new Set())
  const [ghosts, setGhosts] = useState<readonly Listed[]>([])

  useEffect(() => {
    const before = seen.current
    const now = processes(battle).flat()
    const keys = new Map(now.map((p) => [p.key, p]))
    seen.current = { cycle, battle, keys }
    // A new battle, or a step back: nothing was born or died, the battle is another one.
    const forward = battle === before.battle && cycle > before.cycle
    if (reduced || !forward) {
      setBorn(new Set())
      setGhosts([])
      return
    }
    setBorn(new Set(now.filter((p) => !before.keys.has(p.key)).map((p) => p.key)))
    const dead = [...before.keys.values()].filter((p) => !keys.has(p.key))
    if (dead.length === 0) return
    setGhosts((fading) => [...fading.filter((g) => !keys.has(g.key)), ...dead].slice(-MAX_LISTED))
    const timer = setTimeout(
      () => setGhosts((fading) => fading.filter((g) => !dead.includes(g))),
      DEATH_MS,
    )
    return () => clearTimeout(timer)
  }, [cycle, battle, reduced])

  const count = all.reduce((n, list) => n + list.length, 0)
  const selected = state?.selectedProc
  return (
    <Panel
      dense
      title="processes"
      status={battle === null ? undefined : `${count} ${count === 1 ? 'proc' : 'procs'}`}
      className={className}
    >
      {battle === null ? (
        <p className="text-data text-muted">load a bot to see its processes.</p>
      ) : (
        <div className="-mx-2 flex max-h-56 flex-col gap-2 overflow-y-auto">
          {battle.bots.map((bot) => {
            const name = names[bot.index] ?? bot.name
            const list = (all[bot.index] ?? []).slice(0, MAX_LISTED)
            const more = bot.queue.size - list.length
            const fading = ghosts.filter((g) => g.bot === bot.index)
            return (
              <section key={bot.index} aria-label={name}>
                <header className="flex items-center gap-2 px-2 text-data">
                  <HueSwatch hue={bot.index} size={8} />
                  <span className="min-w-0 truncate text-text">{name}</span>
                  <span className="min-w-0 flex-1 truncate text-muted" title="where it was loaded">
                    @ {hexAddress(bot.base)}
                  </span>
                  <span className={cx('shrink-0', bot.alive ? 'text-muted' : 'text-danger')}>
                    {bot.alive
                      ? `${bot.queue.size} ${bot.queue.size === 1 ? 'proc' : 'procs'}`
                      : `dead @ ${(bot.stats.deathCycle ?? 0).toLocaleString('en-US')}`}
                  </span>
                </header>
                <ol aria-label={`${name} queue`}>
                  {list.map((p) => {
                    const on = selected?.bot === p.bot && selected.row === p.row
                    return (
                      <li key={p.key}>
                        <button
                          type="button"
                          aria-current={on || undefined}
                          title={`follow process ${p.index} (row ${p.row})`}
                          onClick={() => onSelect(p.bot, p.row)}
                          data-spawned={born.has(p.key) || undefined}
                          className={cx(
                            'flex w-full min-w-0 items-center gap-2 px-2 text-left text-data transition-colors duration-120 ease-out hover:bg-panel-2 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent data-spawned:animate-[debug-spawn_600ms_ease-out]',
                            on
                              ? 'bg-accent-10 text-bright shadow-[inset_2px_0_0_var(--accent)]'
                              : 'text-text',
                          )}
                        >
                          <span aria-hidden="true" className="w-3 shrink-0 text-muted">
                            {p.index === 0 ? '▸' : ''}
                          </span>
                          <span className="w-5 shrink-0 text-right text-muted">{p.index}</span>
                          <span className="shrink-0 text-muted">{hexAddress(p.ip)}</span>
                          <span className="min-w-0 truncate">
                            {textAt(battle.core.bytes, p.ip, labels)}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                  {fading.map((p) => (
                    <li
                      key={`dead:${p.key}`}
                      aria-hidden="true"
                      className="flex min-w-0 animate-[debug-death_600ms_ease-in_forwards] items-center gap-2 px-2 text-data text-danger"
                    >
                      <span className="w-3 shrink-0">×</span>
                      <span className="w-5 shrink-0 text-right">{p.index}</span>
                      <span className="shrink-0 line-through">{hexAddress(p.ip)}</span>
                      <span className="min-w-0 truncate">died</span>
                    </li>
                  ))}
                </ol>
                {more > 0 && <p className="px-2 text-data text-muted">+ {more} more</p>}
              </section>
            )
          })}
        </div>
      )}
    </Panel>
  )
}
