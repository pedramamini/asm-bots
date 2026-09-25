import { DocsLink, type PageAbout } from '../PageIntro'
import { Terms } from './parts'

export const BOT_ABOUT: PageAbout = {
  name: 'bots',
  docs: 'tournaments/ratings',
  lead: (
    <>
      A bot&rsquo;s page: who wrote it, how big it is, and how it does on the hills. Fork a public
      bot to open a copy in the editor, or challenge it with one of yours in the arena.
    </>
  ),
  details: (
    <>
      <p>
        A bot is saved as versions. Each version is the source and the bytes the server assembled
        from it; a hill and a tournament fight a version, so a later edit never changes a result.
      </p>
      <Terms
        items={[
          ['fights', 'the server matches it has played: hill challenges and tournament matches.'],
          ['placements', 'its rank on each hill it holds a place on.'],
          ['fork', 'a copy of the source in your editor, under your name.'],
          ['challenge', 'one of your bots against this one, in the arena.'],
        ]}
      />
      <p className="text-muted">
        The source shows when the bot is public, or yours. See{' '}
        <DocsLink to="tournaments/hills">hills</DocsLink> for how a rank is made.
      </p>
    </>
  ),
}
