import { Button, cx, IconButton, Modal } from '@asmbots/ui'
import { Link } from '@tanstack/react-router'
import { BookOpen, Info } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import type { PlateName } from '../art'
import { Plate } from '../art/lazy'
import { NavLink } from './Frame'

/** What a page says about itself: a line at its top, and more behind the `ⓘ`. */
export interface PageAbout {
  /** The page's name, as the `ⓘ` and its dialog say it: `hills`. */
  readonly name: string
  /** The line at the top of the page: what the page is, in a sentence or two. */
  readonly lead: ReactNode
  /** The dialog's body: how the page works. */
  readonly details: ReactNode
  /** The docs page that says it all, under `/docs/`: `tournaments/hills`. */
  readonly docs: string
}

/** A link inside an intro's text: underlined, as a link in running text is (DESIGN_SYSTEM §8). */
const INTRO_LINK =
  'rounded-sm text-accent-fg underline underline-offset-2 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent'

export interface PageIntroProps {
  about: PageAbout
  /** A dither plate at the right end, the section's banner (DESIGN_SYSTEM §10); from `md` on. */
  art?: PlateName | undefined
  /** More classes for the box, which spans the page's 12 columns. */
  className?: string | undefined
}

/**
 * The top of a page that explains itself: the page's `lead` beside an `ⓘ`, which opens a dialog
 * with its `details` and a link to its docs. It sits in the page's `PanelGrid`.
 */
export function PageIntro({ about, art, className }: PageIntroProps) {
  return (
    <section
      aria-label={`about ${about.name}`}
      className={cx(
        'col-span-12 flex items-start gap-3 rounded-md border border-border bg-panel px-3 py-2',
        art !== undefined && 'md:min-h-20',
        className,
      )}
    >
      <p className="min-w-0 flex-1 text-body text-muted">{about.lead}</p>
      {art !== undefined && (
        // The plate runs the box's height and fades in from the text's side.
        <div className="-my-2 hidden w-80 shrink-0 self-stretch [mask-image:linear-gradient(to_right,transparent,black_35%)] md:block">
          <Plate name={art} cell={2} />
        </div>
      )}
      <AboutButton about={about} />
    </section>
  )
}

/**
 * The `ⓘ` alone, for a page with no room for a lead (the editor's toolbar): it opens the dialog
 * with the page's `details` and its docs link.
 */
export function AboutButton({
  about,
  tooltip = 'left',
}: {
  about: PageAbout
  tooltip?: 'left' | 'bottom' | undefined
}) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  return (
    <>
      <IconButton
        icon={Info}
        label={`about ${about.name}`}
        tooltip={tooltip}
        onClick={() => setOpen(true)}
      />
      <Modal
        open={open}
        onClose={close}
        title={`about ${about.name}`}
        size="lg"
        actions={
          <>
            <Button variant="ghost" onClick={close}>
              close
            </Button>
            <NavLink to="/docs/$" params={{ _splat: about.docs }} icon={BookOpen}>
              read the docs
            </NavLink>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-body text-text">{about.details}</div>
      </Modal>
    </>
  )
}

/** A link to a docs page inside an intro's details. */
export function DocsLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to="/docs/$" params={{ _splat: to }} className={INTRO_LINK}>
      {children}
    </Link>
  )
}
