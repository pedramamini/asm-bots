/**
 * The welcome tour (PRODUCT_SPEC §9): after the boot screen on a first visit, or from the home
 * page's `take the tour`. Six short steps teach the game (the core, a bot, turns, death, winning,
 * and where everything is), then hand over to the arena's guided first battle (`intro.tsx`),
 * whose last step hands over to the setup and its own tour. `skip the tour`, Escape, and the
 * last step all put the tour away for good.
 */
import { Button, cx, hueColor, Kbd, Modal } from '@asmbots/ui'
import { useRouter } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight, CirclePlay } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useState } from 'react'
import { NAV } from '../Frame'
import { useBoot } from './boot'

/** One step: its title, what it says, and what it shows. */
interface Step {
  readonly title: string
  readonly body: ReactNode
  readonly figure: ReactNode
}

/** What each nav page is for, in the tour's last step. */
const PLACES: Readonly<Record<(typeof NAV)[number]['to'], string>> = {
  '/arena': 'fight any bots, and watch every byte',
  '/editor': 'write a bot; assemble, test, and debug it',
  '/tournaments': 'brackets, round robins, melees, the weekly championship',
  '/hills': 'ladders that never close: submit a bot and climb',
  '/docs': 'the machine, every instruction, and strategy',
}

const CODE = 'rounded-sm border border-border bg-panel-2 px-1 text-bright'

export const TOUR_STEPS: readonly Step[] = [
  {
    title: 'the core',
    body: (
      <>
        <p>
          Every battle runs in one <b className="text-bright">core</b>: 65,536 bytes of memory that
          all bots share, zero at the start. Each bot loads at a random address, and no bot knows
          where the others are.
        </p>
        <p className="text-muted">
          The arena draws the core as a grid, one cell a byte. A cell&rsquo;s hue is the bot that
          wrote it last.
        </p>
      </>
    ),
    figure: (
      <MiniCore
        cells="....aaaaa.............bbbb......"
        ips={[4, 22]}
        caption="two bots, loaded at random. each cell is one byte."
      />
    ),
  },
  {
    title: 'a bot is a program',
    body: (
      <>
        <p>
          A bot is 8086 machine code, 512 bytes at most, that you write in assembly. Once the battle
          starts, nobody steers it: the code is the whole strategy.
        </p>
        <p className="text-muted">
          This is the imp, one of the first two Core War bots (1984). It copies itself one word on,
          then runs the copy, and walks the core forever.
        </p>
      </>
    ),
    figure: (
      <pre className="overflow-x-auto rounded-md border border-border bg-panel-2 p-3 text-code text-text">
        <span className="text-muted">{'        ; bytes  what it does\n'}</span>
        {'imp:    movsw  '}
        <span className="text-accent-fg">A5</span>
        <span className="text-muted">{'     copy this word to the next\n'}</span>
        {'        nop    '}
        <span className="text-accent-fg">90</span>
        <span className="text-muted">{'     then run into the copy'}</span>
      </pre>
    ),
  },
  {
    title: 'turns and processes',
    body: (
      <>
        <p>
          The machine runs in <b className="text-bright">cycles</b>. In each cycle every live bot
          runs one instruction. A bot can start more <b className="text-bright">processes</b> with{' '}
          <code className={CODE}>spl</code>, and they take the bot&rsquo;s turns in rotation.
        </p>
        <p className="text-muted">
          More processes do not make a bot faster. They make it harder to kill.
        </p>
      </>
    ),
    figure: (
      <MiniCore
        cells="..aaaaaa....aaaaaa.......bbbbb.."
        ips={[3, 14, 26]}
        caption="the left bot runs two processes. they take its turns in rotation."
      />
    ),
  },
  {
    title: 'how a bot dies',
    body: (
      <>
        <p>
          A process that runs a bad instruction dies. Most often that is a zero byte,{' '}
          <code className={CODE}>dat</code>. A bot with no process left is dead.
        </p>
        <p className="text-muted">
          So bots attack by writing. A dwarf drops zeros every 4 bytes; an imp copies itself
          forward; a scanner looks for code before it strikes. Nothing is protected: not even your
          own code.
        </p>
      </>
    ),
    figure: (
      <MiniCore
        cells="aaaaaa..A...A...A..bbbbA...A...A"
        ips={[22]}
        caption="the dwarf's bombs (dim) land every 4th byte. the imp on the right runs into one next."
      />
    ),
  },
  {
    title: 'how you win',
    body: (
      <>
        <p>
          The last bot alive wins the round. Bots still alive at the cycle cap share the points: in
          a duel a win scores 3, a tie 1, a loss 0.
        </p>
        <p className="text-muted">
          A match is several rounds, each with a new seed and a new placing. The same bots, config,
          and seed always play the same battle, so every result can be checked.
        </p>
      </>
    ),
    figure: (
      <dl className="grid grid-cols-3 gap-2 text-center">
        {(
          [
            ['win', '3', 'last one running'],
            ['tie', '1', 'alive at the cap'],
            ['loss', '0', 'no process left'],
          ] as const
        ).map(([name, points, note]) => (
          <div key={name} className="flex flex-col gap-1 rounded-md border border-border p-3">
            <dt className="text-panel-title text-muted">{name}</dt>
            <dd className="text-stat text-bright">{points}</dd>
            <dd className="text-data text-muted">{note}</dd>
          </div>
        ))}
      </dl>
    ),
  },
  {
    title: 'where everything is',
    body: (
      <p>
        Your first battle is next: the arena plays Dwarf vs Imp and says what happens, then hands
        the arena to you. After that, go anywhere. The header has every page, and <Kbd>?</Kbd> lists
        every key.
      </p>
    ),
    figure: (
      <ul aria-label="the pages" className="flex flex-col gap-1.5">
        {NAV.map(({ to, label, icon: Icon, key }) => (
          <li key={to} className="flex items-center gap-2 text-data">
            <Icon aria-hidden="true" size={12} strokeWidth={1.75} className="text-accent" />
            <span className="w-24 shrink-0 text-bright">{label}</span>
            <span className="min-w-0 flex-1 text-muted">{PLACES[to]}</span>
            <span className="flex gap-0.5">
              <Kbd>g</Kbd>
              <Kbd>{key}</Kbd>
            </span>
          </li>
        ))}
      </ul>
    ),
  },
]

/** The tour, as a dialog over the page. */
export function WelcomeTour() {
  const [index, setIndex] = useState(0)
  const close = useBoot((state) => state.closeTour)
  const router = useRouter()
  const last = TOUR_STEPS.length - 1
  const step = TOUR_STEPS[index] ?? TOUR_STEPS[0]
  if (step === undefined) return null
  const go = (next: number) => setIndex(Math.min(last, Math.max(0, next)))
  const battle = () => {
    close()
    void router.navigate({ to: '/arena', search: { intro: true } })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === 'ArrowRight') go(index + 1)
    else if (event.key === 'ArrowLeft') go(index - 1)
  }
  return (
    <Modal
      open
      onClose={close}
      onKeyDown={onKeyDown}
      title="the tour"
      size="lg"
      data-tour=""
      actions={
        <>
          {index < last && (
            <Button variant="ghost" className="mr-auto" onClick={close}>
              skip the tour
            </Button>
          )}
          <Button icon={ArrowLeft} disabled={index === 0} onClick={() => go(index - 1)}>
            back
          </Button>
          {index < last ? (
            // The key keeps it a new button each step, so its autoFocus takes the focus again.
            <Button
              key={index}
              variant="primary"
              icon={ArrowRight}
              autoFocus
              onClick={() => go(index + 1)}
            >
              next
            </Button>
          ) : (
            <>
              <Button onClick={close}>look around</Button>
              <Button variant="primary" icon={CirclePlay} autoFocus onClick={battle}>
                watch the first battle
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <p aria-live="polite" className="text-panel-title text-accent-fg">
            {index + 1} / {TOUR_STEPS.length} · {step.title}
          </p>
          <span aria-hidden="true" className="ml-auto flex gap-1">
            {TOUR_STEPS.map((s, i) => (
              <span
                key={s.title}
                className={cx(
                  'h-1 w-4 rounded-full',
                  i <= index ? 'bg-accent' : 'bg-border-strong',
                )}
              />
            ))}
          </span>
        </div>
        <div className="flex flex-col gap-2 text-body">{step.body}</div>
        {step.figure}
      </div>
    </Modal>
  )
}

/** A cell of `MiniCore`: `.` zero, `a`/`b` a bot's byte, `A`/`B` a zero that bot wrote (a bomb). */
const CELL_BOT: Readonly<Record<string, number>> = { a: 0, b: 1, A: 0, B: 1 }

/** The hues the figures use: the arena's bot 1 and bot 2 (red and orange read apart on black). */
const FIGURE_HUES = [4, 0] as const

/**
 * A strip of the core, one cell a byte, on the arena's black: `cells` spells it, and `ips` are the
 * cells a process runs next (white outlines, as in the arena).
 */
function MiniCore({
  cells,
  ips,
  caption,
}: {
  cells: string
  ips: readonly number[]
  caption: string
}) {
  const size = 14
  const gap = 3
  const width = cells.length * (size + gap) - gap
  return (
    <figure className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-md border border-border bg-arena-bg p-3">
        <svg
          aria-hidden="true"
          viewBox={`-2 -2 ${width + 4} ${size + 4}`}
          className="h-auto w-full min-w-[420px]"
        >
          {[...cells].map((cell, i) => {
            const bot = CELL_BOT[cell]
            const x = i * (size + gap)
            const fill =
              bot === undefined ? 'var(--arena-ruler)' : hueColor(FIGURE_HUES[bot] ?? bot)
            const dim = bot === undefined ? 0.3 : cell === 'A' || cell === 'B' ? 0.4 : 1
            return (
              <g key={`${i}${cell}`}>
                <rect
                  x={x}
                  y={0}
                  width={size}
                  height={size}
                  rx={2}
                  style={{ fill }}
                  opacity={dim}
                />
                {ips.includes(i) && (
                  <rect
                    x={x - 1.5}
                    y={-1.5}
                    width={size + 3}
                    height={size + 3}
                    rx={3}
                    fill="none"
                    style={{ stroke: 'var(--arena-ip)' }}
                    strokeWidth={1.5}
                  />
                )}
              </g>
            )
          })}
        </svg>
      </div>
      <figcaption className="text-data text-muted">{caption}</figcaption>
    </figure>
  )
}
