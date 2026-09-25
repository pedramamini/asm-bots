import { DocsLink, type PageAbout } from '../PageIntro'
import { Steps, Terms } from './parts'

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
