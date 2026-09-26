import { Blocks, LayoutTemplate, Palette, SlidersHorizontal, Table2 } from 'lucide-react'
import { type ReactNode, useEffect, useLayoutEffect, useState } from 'react'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { Chip } from '../primitives/Chip'
import { Header } from '../primitives/Header'
import { NavButton } from '../primitives/NavButton'
import { PanelGrid } from '../primitives/PanelGrid'
import { Segmented } from '../primitives/Segmented'
import { ToastProvider } from '../primitives/Toast'
import { Toolbar } from '../primitives/Toolbar'
import { applyTheme, initTheme, isTheme, THEMES, type Theme } from '../themes'
import { ControlSpecimens } from './ControlSpecimens'
import { DataSpecimens } from './DataSpecimens'
import { LayoutSpecimens } from './LayoutSpecimens'
import { ArenaLayout, HillLayout, TournamentLayout } from './layouts'
import { TokenSheet } from './TokenSheet'

/** The query parameter that picks the theme: `/_gallery?theme=paper`. */
export const GALLERY_THEME_PARAM = 'theme'

/** The page's sections, in order, for the header's nav. */
const SECTIONS = [
  { id: 'layouts', label: 'layouts', icon: LayoutTemplate },
  { id: 'tokens', label: 'tokens', icon: Palette },
  { id: 'layout', label: 'layout', icon: Blocks },
  { id: 'controls', label: 'controls', icon: SlidersHorizontal },
  { id: 'data', label: 'data', icon: Table2 },
] as const

/**
 * The kit on one page, for review against the design system and its references: the three
 * reference layouts of DESIGN_SYSTEM §4, every token, and every primitive in every state. A theme
 * switcher sits at the top; `?theme=<name>` picks the theme on load, and the switcher keeps the
 * query in step. The gallery borrows the theme: it does not store it, and it puts the stored
 * theme back when it unmounts. The web app mounts it at `/_gallery` in development.
 */
export function Gallery() {
  const [theme, setTheme] = useState<Theme>(startTheme)
  const reducedMotion = useReducedMotion()
  /** True once the fonts have loaded (at once without the font API): a screenshot waits for it. */
  const [ready, setReady] = useState(() => typeof document.fonts === 'undefined')

  useLayoutEffect(() => {
    applyTheme(theme, { persist: false })
  }, [theme])

  // Borrowed, not kept: the stored (or the system's) theme comes back when the gallery goes.
  useEffect(() => () => void initTheme(), [])

  useEffect(() => {
    if (typeof document.fonts === 'undefined') return
    let live = true
    document.fonts.ready.then(() => {
      if (live) setReady(true)
    })
    return () => {
      live = false
    }
  }, [])

  const choose = (next: Theme) => {
    setTheme(next)
    const url = new URL(window.location.href)
    url.searchParams.set(GALLERY_THEME_PARAM, next)
    window.history.replaceState(window.history.state, '', url)
  }

  return (
    <ToastProvider>
      <div data-gallery-ready={ready || undefined} className="min-h-full bg-bg text-body text-text">
        <h1 className="sr-only">ASM Bots UI kit gallery</h1>
        <div className="sticky top-0 z-header">
          <Header
            brand={
              <>
                ASM BOTS <span className="text-muted">{'// gallery'}</span>
              </>
            }
            stat="33 primitives · 3 layouts · 9 themes"
            nav={SECTIONS.map(({ id, label, icon }) => (
              <NavButton key={id} href={`#${id}`} icon={icon}>
                {label}
              </NavButton>
            ))}
            navLabel="gallery sections"
          />
          <Toolbar aria-label="gallery">
            <span className="text-panel-status text-muted">theme</span>
            <Segmented label="theme" options={THEMES} value={theme} onValueChange={choose} />
            <span className="text-data text-muted">
              ?{GALLERY_THEME_PARAM}={theme}
            </span>
            <Chip className="ml-auto">motion · {reducedMotion ? 'reduced' : 'full'}</Chip>
          </Toolbar>
        </div>
        <main className="isolate flex flex-col gap-8 p-3 pb-16">
          <Section
            id="layouts"
            title="reference layouts"
            note="DESIGN_SYSTEM §4 · placeholder data"
          >
            <ArenaLayout theme={theme} />
            <HillLayout />
            <TournamentLayout />
          </Section>
          <Section
            id="tokens"
            title="tokens"
            note="DESIGN_SYSTEM §2 · §3 · as the browser resolves them"
          >
            <PanelGrid>
              <TokenSheet theme={theme} />
            </PanelGrid>
          </Section>
          <Section id="layout" title="layout" note="7 primitives">
            <PanelGrid>
              <LayoutSpecimens theme={theme} />
            </PanelGrid>
          </Section>
          <Section
            id="controls"
            title="controls"
            note="12 primitives · hover and focus forced in screenshots"
          >
            <PanelGrid>
              <ControlSpecimens />
            </PanelGrid>
          </Section>
          <Section id="data" title="data display and feedback" note="14 primitives">
            <PanelGrid>
              <DataSpecimens />
            </PanelGrid>
          </Section>
        </main>
      </div>
    </ToastProvider>
  )
}

/** The theme to open on: `?theme=`, else the one on the page, else the stored or system one. */
function startTheme(): Theme {
  const asked = new URLSearchParams(window.location.search).get(GALLERY_THEME_PARAM)
  if (isTheme(asked)) return asked
  const shown = document.documentElement.dataset.theme
  return isTheme(shown) ? shown : initTheme()
}

interface SectionProps {
  id: string
  title: string
  note: string
  children: ReactNode
}

/** A part of the page: a heading over a hairline, then its sheets. The header's nav links here. */
function Section({ id, title, note, children }: SectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-22 flex-col gap-3">
      <div className="flex items-baseline gap-3 border-b border-border pb-2">
        <h2 id={`${id}-title`} className="text-panel-title text-bright">
          {title}
        </h2>
        <span className="text-data text-muted">{note}</span>
      </div>
      {children}
    </section>
  )
}
