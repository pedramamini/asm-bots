/**
 * The editor's two routes, as their components: `/editor` (a new bot, or what a link hands over)
 * and `/editor/$botId` (a bot of this browser, or a roster bot, read-only). The route files mount
 * them; the tests mount them with their own services.
 */
import { useLocation, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'
import { parseRefs, sharedBots } from '../arena/setup/url'
import { type DocTarget, SCRATCH, targetOfParam } from './doc'
import { EditorPage, type EditorPageProps } from './EditorPage'
import { validateEditorSearch } from './search'
import { isTemplateId } from './templates'

/** What the routes hand the page besides the document: its Workers, and the assemble delay. */
export type EditorServices = Pick<
  EditorPageProps,
  'createAssembler' | 'createArena' | 'assembleDelay'
>

/**
 * `/editor`: the arena's `open in debugger` sends its setup (`?b=roster:dwarf,roster:imp&seed=1`)
 * and the editor opens its first bot; a share link carries a source in `#src=`, which opens as a
 * bot not saved yet; `?t=dwarf` starts the new bot from a template. Else, the new bot.
 */
export function EditorIndexRoute(services: EditorServices) {
  const raw = useSearch({ strict: false })
  const search = useMemo(() => validateEditorSearch(raw), [raw])
  const hash = useLocation({ select: (location) => location.hash })
  const navigate = useNavigate()
  const shared = useMemo(() => sharedBots(hash), [hash])
  const first = search.b === undefined ? undefined : parseRefs(search.b)[0]
  const sharedId = shared.keys().next().value
  const target: DocTarget =
    first ?? (sharedId === undefined ? SCRATCH : { kind: 'local', id: sharedId })
  const template = search.t !== undefined && isTemplateId(search.t) ? search.t : null
  const dropTemplate = useCallback(() => {
    void navigate({ to: '/editor', search: ({ t: _t, ...rest }) => rest, hash, replace: true })
  }, [navigate, hash])
  return (
    <EditorPage
      {...services}
      target={target}
      shared={shared}
      template={template}
      onTemplateDone={dropTemplate}
    />
  )
}

/** `/editor/$botId`: a bot of this browser by id, or a roster bot, `/editor/roster-dwarf`. */
export function EditorBotRoute(services: EditorServices) {
  const { botId = '' } = useParams({ strict: false }) as { botId?: string }
  const hash = useLocation({ select: (location) => location.hash })
  const shared = useMemo(() => sharedBots(hash), [hash])
  const target = useMemo(() => targetOfParam(botId), [botId])
  return <EditorPage {...services} target={target} shared={shared} />
}
