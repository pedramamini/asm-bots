import { Button, useToast } from '@asmbots/ui'
import { CodeXml, Copy, Grid2x2 } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { NavLink } from '../app/Frame'
import { textOf } from './text'

type Runtime = typeof import('./asm-runtime')

let runtime: Promise<Runtime> | null = null

/** The block's colors and links, loaded once for every block, after the page paints. */
export function loadAsmRuntime(): Promise<Runtime> {
  runtime ??= import('./asm-runtime').catch((error: unknown) => {
    runtime = null
    throw error
  })
  return runtime
}

function useAsmRuntime(): Runtime | null {
  const [loaded, setLoaded] = useState<Runtime | null>(null)
  useEffect(() => {
    let live = true
    loadAsmRuntime().then(
      (module) => live && setLoaded(module),
      // No colors and no links: the block still shows its text and copies it.
      () => {},
    )
    return () => {
      live = false
    }
  }, [])
  return loaded
}

/** A `run` of `vs=imp` or `vs=imp seed=7`: the roster bot to fight, and a fixed seed. */
export interface AsmRun {
  vs: string
  seed?: number | undefined
}

/** The run a block is tagged with, or null when the tag is not one. */
export function parseRun(run: string): AsmRun | null {
  const match = /^vs=([a-z0-9_-]{1,64})(?:\s+seed=(\d{1,10}))?$/.exec(run.trim())
  if (match === null) return null
  const seed = match[2] === undefined ? undefined : Number(match[2])
  if (seed !== undefined && seed > 0xffffffff) return null
  return { vs: match[1] as string, seed }
}

/**
 * A block's source: its text less the blank lines around it and the indent every line shares,
 * so a template literal in MDX can sit indented.
 */
export function blockSource(text: string): string {
  const lines = text.replace(/\t/g, '        ').split('\n')
  while (lines.length > 0 && (lines[0] as string).trim() === '') lines.shift()
  while (lines.length > 0 && (lines[lines.length - 1] as string).trim() === '') lines.pop()
  const indent = Math.min(
    ...lines.filter((line) => line.trim() !== '').map((line) => /^ */.exec(line)?.[0].length ?? 0),
  )
  return lines.map((line) => line.slice(Number.isFinite(indent) ? indent : 0).trimEnd()).join('\n')
}

/** The bot's `%name`, as the block's label shows it; null for a block without one. */
function botName(source: string): string | null {
  return /^\s*%name\s+"([^"]*)"/m.exec(source)?.[1] ?? null
}

export interface AsmProps {
  /** The source: a string, or a template literal in MDX, `<Asm>{`…`}</Asm>`. */
  children?: ReactNode
  /** `vs=imp` (and `seed=7`): an `open in arena` that fights the block against that roster bot. */
  run?: string | undefined
  /** A piece of a bot, not a whole one: it copies, but opens nowhere (no `%name`, no bytes). */
  fragment?: boolean | undefined
}

/**
 * An x16c code block of the docs (PRODUCT_SPEC §7): the source in the editor's colors, `copy`,
 * `open in editor` (a whole bot opens as a bot not saved yet), and for a block tagged
 * `run="vs=imp"`, `open in arena` against that roster bot. The colors and links arrive with the
 * runtime (`asm-runtime.ts`); until then the text is plain and the links wait, disabled.
 */
export function Asm({ children, run, fragment = false }: AsmProps) {
  const source = blockSource(textOf(children))
  const { toast } = useToast()
  const loaded = useAsmRuntime()
  const fight = run === undefined || fragment ? null : parseRun(run)
  const name = fragment ? null : botName(source)

  const copy = () => {
    navigator.clipboard.writeText(source).then(
      () => toast('copied.', { variant: 'accent' }),
      () => toast('could not copy the code.', { variant: 'danger' }),
    )
  }

  const lines = loaded === null ? null : loaded.highlight(source)
  return (
    <figure
      aria-label={name === null ? 'x16c code' : `${name} · x16c code`}
      className="my-3 min-w-0 rounded-sm border border-border bg-panel-2"
    >
      <figcaption className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1">
        <span className="mr-auto truncate text-panel-status text-dim">
          {name === null ? (fragment ? 'x16c · fragment' : 'x16c') : `${name} · x16c`}
        </span>
        <Button variant="ghost" icon={Copy} onClick={copy}>
          copy
        </Button>
        {!fragment &&
          (loaded === null ? (
            <Button icon={CodeXml} disabled>
              open in editor
            </Button>
          ) : (
            <NavLink to="/editor" hash={loaded.editorHash(source)} icon={CodeXml}>
              open in editor
            </NavLink>
          ))}
        {fight !== null &&
          (loaded === null ? (
            <Button icon={Grid2x2} disabled>
              open in arena · vs {fight.vs}
            </Button>
          ) : (
            <NavLink to="/arena" {...loaded.arenaLink(source, fight.vs, fight.seed)} icon={Grid2x2}>
              open in arena · vs {fight.vs}
            </NavLink>
          ))}
      </figcaption>
      {/* A long line scrolls the block sideways; it never wraps (a wrapped line reads as two). */}
      <pre className="overflow-x-auto p-3 text-code text-text">
        <code className="whitespace-pre">
          {lines === null
            ? source
            : lines.map((spans, row) => (
                <span key={row}>
                  {spans.map((span, at) =>
                    span.color === null ? (
                      span.text
                    ) : (
                      <span key={at} style={{ color: span.color }}>
                        {span.text}
                      </span>
                    ),
                  )}
                  {row < lines.length - 1 && '\n'}
                </span>
              ))}
        </code>
      </pre>
    </figure>
  )
}
