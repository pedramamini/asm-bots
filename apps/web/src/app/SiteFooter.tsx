import { Link } from '@tanstack/react-router'
import { DitherPlate } from '../art/DitherPlate'
import { FOOTER_HILLS, FOOTER_PEAKS, footerRange } from '../art/scenes'

/** The repository, for the footer's `source` link. */
const REPO = 'https://github.com/pedramamini/asm-bots'

/** A keyboard focus: the kit's 1 px accent outline, 2 px out (DESIGN_SYSTEM §8). */
const FOCUS = 'focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent'

/** A footer link: muted, the accent on hover, underlined as a link in running text is not. */
const LINK = `rounded-sm text-muted underline-offset-2 hover:text-accent-fg hover:underline ${FOCUS}`

/** A footer link: a route of the site (`to`), or another site (`href`). */
type FooterLink =
  | { readonly label: string; readonly to: string }
  | { readonly label: string; readonly href: string }

type Column = {
  readonly title: string
  readonly links: readonly FooterLink[]
}

const COLUMNS: readonly Column[] = [
  {
    title: 'play',
    links: [
      { label: 'arena', to: '/arena' },
      { label: 'editor', to: '/editor' },
    ],
  },
  {
    title: 'compete',
    links: [
      { label: 'hills', to: '/hills' },
      { label: 'tournaments', to: '/tournaments' },
    ],
  },
  {
    title: 'learn',
    links: [
      { label: 'start here', to: '/docs/start-here' },
      { label: 'the machine', to: '/docs/machine/memory' },
      { label: 'strategy', to: '/docs/strategy/imps' },
    ],
  },
  {
    title: 'project',
    links: [
      { label: 'source', href: REPO },
      { label: 'command line', to: '/docs/tools/cli' },
      { label: 'api', to: '/docs/tools/api' },
      { label: 'for agents', to: '/docs/tools/agents' },
    ],
  },
]

/** The pole's height in the footer scene (`range`), 0..1 of the plate's: where a flag's label sits. */
const POLE = 0.24

/**
 * The foot of every page that scrolls (DESIGN_SYSTEM §10): the hills as a dither range, each
 * seeded hill's flag labeled with its name and a link to it, then the site's links. The arena and
 * the editor fill the screen and have none.
 */
export function SiteFooter() {
  const flags = FOOTER_PEAKS.filter((peak) => peak.flag === true)
  return (
    <footer className="mt-3 border-t border-border">
      <div className="relative h-32">
        <DitherPlate scene={footerRange} />
        {flags.map((peak, index) => {
          const hill = FOOTER_HILLS[index]
          if (hill === undefined) return null
          return (
            <Link
              key={hill}
              to="/hills/$slug"
              params={{ slug: hill }}
              className={`absolute translate-x-5 rounded-sm bg-bg px-1 text-panel-status text-muted uppercase hover:text-accent-fg ${FOCUS}`}
              style={{
                left: `${peak.x * 100}%`,
                top: `calc(${(1 - peak.height - POLE) * 100}% - 2px)`,
              }}
            >
              {hill}
            </Link>
          )
        })}
      </div>
      <nav aria-label="site" className="grid grid-cols-2 gap-6 px-3 py-5 md:grid-cols-5">
        <div className="col-span-2 flex flex-col gap-1 md:col-span-1">
          <span className="text-brand text-bright">ASM BOTS</span>
          <span className="text-data text-muted">core war, in 8086</span>
        </div>
        {COLUMNS.map((column) => (
          <div key={column.title} className="flex flex-col gap-1.5">
            <span className="text-panel-title text-accent-fg">{column.title}</span>
            <ul className="flex flex-col gap-1 text-data">
              {column.links.map((link) => (
                <li key={link.label}>
                  {'href' in link ? (
                    <a href={link.href} className={LINK}>
                      {link.label}
                    </a>
                  ) : (
                    <Link to={link.to} className={LINK}>
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </footer>
  )
}
