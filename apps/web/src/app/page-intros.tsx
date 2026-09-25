/**
 * What the arena, the hills, and the tournaments say about themselves (`PageIntro`): the line at
 * the top of each, and the dialog behind its `ⓘ`.
 */
import type { ReactNode } from 'react'
import { DocsLink, type PageAbout } from './PageIntro'

const STEPS = 'flex list-decimal flex-col gap-1 pl-7 marker:text-muted'
const TERMS = 'grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1'

function Steps({ children }: { children: ReactNode }) {
  return <ol className={STEPS}>{children}</ol>
}

/** A term and what it means, in a two-column list. */
function Terms({ items }: { items: readonly (readonly [term: string, meaning: ReactNode])[] }) {
  return (
    <dl className={TERMS}>
      {items.map(([term, meaning]) => (
        <div key={term} className="contents">
          <dt className="text-bright">{term}</dt>
          <dd className="text-muted">{meaning}</dd>
        </div>
      ))}
    </dl>
  )
}

export const ARENA_ABOUT: PageAbout = {
  name: 'the arena',
  docs: 'start-here',
  lead: (
    <>
      The arena is your sandbox. Pick two or more bots, set the rules, and watch them fight in one
      64 KB core. Nothing here goes on a ladder: it is for testing, learning, and sharing a fight.
    </>
  ),
  details: (
    <>
      <p>
        Each bot is 8086 machine code, loaded at a random address in one shared 64 KB core. The
        machine runs one instruction of each live process in turn. A process that runs a zero byte
        dies; a bot with no process left is dead. The last bot alive wins the round.
      </p>
      <Steps>
        <li>
          <b className="text-bright">Pick bots</b> from the roster, your own bots, or a pasted or
          dropped <code>.asm</code> file. Up to 16 bots can share one core.
        </li>
        <li>
          <b className="text-bright">Set the config</b>: a preset (<code>duel</code>,{' '}
          <code>melee 8</code>, <code>hill rules</code>) or your own rounds, cycles, process cap,
          and spacing.
        </li>
        <li>
          <b className="text-bright">Fight</b>. Press <kbd>space</kbd> to pause, <kbd>.</kbd> to
          step one cycle, and <kbd>?</kbd> for every key. Click a line of the events log to go back
          to it.
        </li>
      </Steps>
      <Terms
        items={[
          ['cell', 'one byte of the core, 256 to a row. Its hue is the bot that wrote it last.'],
          ['outline', 'a live process: the address it runs next.'],
          ['seed', 'places the bots. The same bots, config, and seed play the same battle.'],
        ]}
      />
      <p className="text-muted">
        New here? The header&rsquo;s <code>intro</code> runs a guided 30-second battle. To learn the
        machine, read <DocsLink to="machine/memory">memory</DocsLink> and{' '}
        <DocsLink to="machine/death">death</DocsLink>.
      </p>
    </>
  ),
}

export const HILLS_ABOUT: PageAbout = {
  name: 'hills',
  docs: 'tournaments/hills',
  lead: (
    <>
      A hill is a standing ladder that never ends. Submit a bot and the server fights it against
      every bot on the hill. The best bot is the king; when the hill is full, the lowest bot is
      pushed off.
    </>
  ),
  details: (
    <>
      <p>
        A hill is a round robin that stays open. Each hill has its own rules (rounds, cycles, and
        the largest bot it takes) and its own size. The roster&rsquo;s bots hold the hills from the
        start.
      </p>
      <Steps>
        <li>
          <b className="text-bright">Sign in</b> and save a bot to your account from the editor.
        </li>
        <li>
          <b className="text-bright">Submit</b> a version from a hill&rsquo;s page. The server uses
          the bytes it assembled when you saved, and fights one match against each entry.
        </li>
        <li>
          <b className="text-bright">Rank</b>. The field ranks by total score. If the hill is now
          over its size, the lowest bot goes. To stay, your bot must score more than the lowest
          entry: a tie is not enough.
        </li>
      </Steps>
      <Terms
        items={[
          ['king', 'the bot at the top of a hill.'],
          ['score', 'the sum of a bot’s match points against every other bot on the hill.'],
          ['age', 'the challenges a bot has survived. Level scores rank the older bot higher.'],
          ['challenge', 'fights one of your bots against an entry in the arena, under hill rules.'],
        ]}
      />
      <p className="text-muted">
        Every hill match is reproducible: <code>watch</code> it in the arena and check it (see{' '}
        <DocsLink to="tournaments/verification">verification</DocsLink>). For strategy, read{' '}
        <DocsLink to="strategy/hill-meta">hill meta</DocsLink>.
      </p>
    </>
  ),
}

export const TOURNAMENTS_ABOUT: PageAbout = {
  name: 'tournaments',
  docs: 'tournaments/formats',
  lead: (
    <>
      A tournament is a one-time event with a champion. Run a round robin, a bracket, or a melee of
      any bots here, in your browser, or enter the server&rsquo;s weekly championship.
    </>
  ),
  details: (
    <>
      <p>
        A tournament is made of matches, and a match is a set of rounds with the same bots. Each
        round uses the next seed and rotates the bot order, so no bot always goes first.
      </p>
      <Terms
        items={[
          ['round robin', 'every bot fights every other bot once. The fairest, and the slowest.'],
          ['bracket', 'single elimination: the loser of a match is out. The final crowns it.'],
          ['melee', 'all the bots share one core, every round.'],
        ]}
      />
      <Steps>
        <li>
          <b className="text-bright">New tournament</b>: give it a name and a kind, pick the bots,
          and pick a config or a preset.
        </li>
        <li>
          <b className="text-bright">Run it</b>. Matches play one at a time in the background. The
          tournament saves after every match, so a reload goes on from where it stopped.
        </li>
        <li>
          <b className="text-bright">Watch</b> any match in the arena, or share the tournament as a
          link.
        </li>
      </Steps>
      <p className="text-muted">
        Cards with the <code>server</code> chip run on the server. The weekly championship starts
        every Saturday at 18:00 UTC: sign in and <code>enter</code> one of your bots. See{' '}
        <DocsLink to="tournaments/brackets">brackets</DocsLink> for seeds and byes.
      </p>
    </>
  ),
}
