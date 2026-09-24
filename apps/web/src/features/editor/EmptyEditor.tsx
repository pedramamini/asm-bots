/**
 * The new bot's empty state (PRODUCT_SPEC §3): while `/editor` holds the blank template as it
 * comes, or no text, the templates menu sits front and center over the editor. A template starts
 * the bot from it; typing, or `close`, puts the panel away.
 */
import { cx, IconButton, Panel } from '@asmbots/ui'
import { X } from 'lucide-react'
import { useId } from 'react'
import { TEMPLATES, type TemplateId } from './templates'

export interface EmptyEditorProps {
  /** No text at all: the panel takes the middle of the editor, not the space under the blank bot. */
  empty: boolean
  /** A template, picked: the page starts the bot from it. */
  onTemplate: (id: TemplateId) => void
  /** `close`: the page keeps the text and puts the panel away. */
  onClose: () => void
}

/**
 * A template's row: the menu's item, with what the template is beside its name. The keyboard's
 * focus takes the kit's ring, inset, so it stays clear of the rows beside it.
 */
const ROW = cx(
  'flex h-6 w-full items-center gap-3 rounded-sm px-2 text-left text-data transition-colors duration-120 ease-out',
  'hover:bg-accent-10 focus-visible:bg-accent-10 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent',
)

export function EmptyEditor({ empty, onTemplate, onClose }: EmptyEditorProps) {
  const id = useId()
  return (
    // Under the blank bot's five lines (with no text, in the middle); a press beside the panel
    // reaches the editor.
    <div
      className={cx(
        'pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-6 pb-3',
        empty ? 'pt-3' : 'pt-28',
      )}
    >
      <Panel
        title="new bot"
        actions={
          <IconButton
            icon={X}
            size="sm"
            label="close"
            className="border-transparent"
            onClick={onClose}
          />
        }
        className="pointer-events-auto w-full max-w-lg"
      >
        <p className="text-muted">start from a template, or type over this one.</p>
        <ul aria-label="templates" className="mt-1 flex flex-col">
          {TEMPLATES.map((template) => (
            <li key={template.id}>
              <button
                type="button"
                aria-label={template.label}
                aria-describedby={`${id}-${template.id}`}
                onClick={() => onTemplate(template.id)}
                className={ROW}
              >
                <span className="w-36 shrink-0 text-accent">{template.label}</span>
                <span id={`${id}-${template.id}`} className="min-w-0 truncate text-muted">
                  {template.detail}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}
