import { describe, expect, it } from 'bun:test'
import { act, render, screen, waitFor } from '@testing-library/react'
import { useDom } from '../../../packages/ui/test/dom'
import { ANNOUNCE_MS, Announcer, arenaSummary } from '../src/features/arena/battle/Announcer'
import { type ArenaClient, createArenaStore } from '../src/features/arena/worker/client'
import type { ArenaBotMeta } from '../src/features/arena/worker/protocol'

useDom()

const bot = (name: string) => ({ name }) as ArenaBotMeta

/** Stats of `footprints.length` bots: procs 1 each, the footprints given, no writes. */
function stats(footprints: readonly number[]): Float32Array {
  return new Float32Array(footprints.flatMap((footprint) => [1, footprint, 0]))
}

describe('arenaSummary', () => {
  it('says the cycle, the bots alive, and who owns the most core (DESIGN_SYSTEM §8)', () => {
    const line = arenaSummary({
      cycle: 12_480,
      alive: 3,
      botMeta: [bot('imp'), bot('dwarf-v3'), bot('stone')],
      stats: stats([120, 4_096, 900]),
    })
    expect(line).toBe('cycle 12,480; 3 bots alive; dwarf-v3 leads footprint')
  })

  it('counts one bot as one, and names no leader before anyone owns a byte', () => {
    expect(arenaSummary({ cycle: 0, alive: 1, botMeta: [bot('imp')], stats: stats([0]) })).toBe(
      'cycle 0; 1 bot alive',
    )
  })

  it('names the first of two bots that tie for the most', () => {
    expect(
      arenaSummary({
        cycle: 7,
        alive: 2,
        botMeta: [bot('imp'), bot('dwarf')],
        stats: stats([64, 64]),
      }),
    ).toBe('cycle 7; 2 bots alive; imp leads footprint')
  })
})

describe('Announcer', () => {
  function mount(every: number) {
    const store = createArenaStore()
    store.setState({ botMeta: [bot('imp'), bot('dwarf')], stats: stats([10, 30]), alive: 2 })
    render(<Announcer client={{ store } as unknown as ArenaClient} every={every} />)
    return store
  }

  it('speaks every 2 s by default', () => {
    expect(ANNOUNCE_MS).toBe(2000)
  })

  it('is a polite status region, hidden from sight, silent until the battle plays', async () => {
    const store = mount(10)
    const region = screen.getByRole('status')
    expect(region.className).toBe('sr-only')
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(region.textContent).toBe('')
    act(() => store.setState({ status: 'playing', cycle: 1_200 }))
    await waitFor(() =>
      expect(region.textContent).toBe('cycle 1,200; 2 bots alive; dwarf leads footprint'),
    )
    act(() => store.setState({ cycle: 2_400 }))
    await waitFor(() =>
      expect(region.textContent).toBe('cycle 2,400; 2 bots alive; dwarf leads footprint'),
    )
  })

  it('stops speaking when the battle pauses or ends', async () => {
    const store = mount(10)
    const region = screen.getByRole('status')
    act(() => store.setState({ status: 'playing', cycle: 100 }))
    await waitFor(() => expect(region.textContent).toStartWith('cycle 100;'))
    act(() => store.setState({ status: 'paused', cycle: 200 }))
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(region.textContent).toStartWith('cycle 100;')
    act(() => store.setState({ status: 'ended', cycle: 300 }))
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(region.textContent).toStartWith('cycle 100;')
  })
})
