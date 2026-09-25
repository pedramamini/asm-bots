import { DocsLink, type PageAbout } from '../PageIntro'
import { Steps, Terms } from './parts'

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
