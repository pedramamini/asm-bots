import { DocsLink, type PageAbout } from '../PageIntro'
import { Steps, Terms } from './parts'

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
