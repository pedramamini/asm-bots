/**
 * The intro's fight (`src/features/arena/intro.tsx`): what the header's `intro` loads, and that
 * the battle it plays is the one its guide narrates: Dwarf's bomb on Imp, first blood and the
 * end, late enough to watch at 200 cycles a frame.
 */
import { describe, expect, it } from 'bun:test'
import { fighter } from '@asmbots/bots'
import { DEFAULT_CONFIG, simulate } from '@asmbots/engine'
import {
  INTRO_BOTS,
  INTRO_HOLD_MS,
  INTRO_SEED,
  INTRO_SPEED,
  introFight,
  introSpec,
} from '../src/features/arena/intro'
import { DEFAULT_ARENA_CONFIG } from '../src/features/arena/setup/config'
import { validateArenaSearch } from '../src/features/arena/setup/search'
import { searchFromSetup } from '../src/features/arena/setup/url'

/** The cycle Dwarf's bomb lands on Imp's next word at the intro's seed. */
const FIRST_BLOOD = 55_602

describe('the intro', () => {
  it('loads Dwarf then Imp, in the duel config, at its fixed seed', () => {
    const fight = introFight()
    expect(fight.bots.map((bot) => bot.name)).toEqual(['Dwarf', 'Imp'])
    expect(fight.bots.map((bot) => [...bot.bytes])).toEqual(
      ['dwarf', 'imp'].map((slug) => [...fighter(slug).bytes]),
    )
    expect(fight.config).toEqual({
      maxCycles: DEFAULT_CONFIG.maxCycles,
      maxProcesses: DEFAULT_CONFIG.maxProcesses,
      minSpacing: DEFAULT_CONFIG.minSpacing,
      seed: INTRO_SEED,
    })
    expect(fight.rounds).toBe(1)
    expect(fight.spec).toEqual(introSpec())
    expect(fight.spec.bots).toEqual(INTRO_BOTS)
    expect(fight.spec.config).toEqual({ ...DEFAULT_ARENA_CONFIG, seed: INTRO_SEED })
    expect(fight.shared).toEqual([])
    // The URL it leaves behind: the bots and the seed, so a reload keeps them.
    expect(searchFromSetup(fight.spec)).toMatchObject({
      b: 'roster:dwarf,roster:imp',
      seed: INTRO_SEED,
    })
  })

  it("plays Dwarf's bomb on Imp at cycle 55,602: first blood, and the end", () => {
    const result = simulate([fighter('dwarf'), fighter('imp')], introFight().config)
    expect(result.survivors).toEqual([0])
    expect(result.cycles).toBe(FIRST_BLOOD + 1)
    const [dwarf, imp] = result.bots
    expect(dwarf?.alive).toBe(true)
    // A bomb is a DAT word: Imp dies running it. The arena's log calls it first blood, Dwarf's
    // (`test/arena-battle-view.test.tsx`, the intro's guide).
    expect(imp).toMatchObject({ alive: false, deathCycle: FIRST_BLOOD, deathReason: 'dat' })
  })

  it('holds the placement a few seconds, then about 5 s of play at 60 fps: about 30 s in all', () => {
    expect(INTRO_SPEED).toBe(200)
    expect(INTRO_HOLD_MS).toBe(6000)
    const playSeconds = FIRST_BLOOD / (INTRO_SPEED as number) / 60
    expect(playSeconds).toBeGreaterThan(4)
    expect(playSeconds).toBeLessThan(6)
  })

  it('starts from the query the header links to, or one typed by hand', () => {
    for (const intro of [true, 1, '', '1']) {
      expect(validateArenaSearch({ intro })).toEqual({ intro: true })
    }
    for (const intro of [false, 0, '0', 'no', null, undefined]) {
      expect(validateArenaSearch({ intro })).toEqual({})
    }
  })
})
