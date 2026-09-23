import { type ReactNode, useEffect, useRef, useState } from 'react'
import { contrastRatio } from '../color'
import { HueSwatch } from '../primitives/HueSwatch'
import { Identicon } from '../primitives/Identicon'
import { Panel } from '../primitives/Panel'
import { cx, vars } from '../style'
import type { Theme } from '../themes'
import { ArenaMock } from './ArenaMock'
import { HOTSPOT } from './battle'

/*
 * The tokens as the browser resolves them in the current theme (DESIGN_SYSTEM §2, §3): each color
 * as a swatch with its value, each text token on each surface with its WCAG ratio, the arena's
 * colors in place, the bot hues, the scales, and each type role with its computed metrics.
 */

const SURFACES = ['--bg', '--panel', '--panel-2'] as const
const LINES = ['--border', '--border-strong'] as const
/** Each text token and its floor on every surface, as `bun run contrast` gates it (§8). */
const TEXTS = [
  ['--text-bright', 4.5],
  ['--text', 4.5],
  ['--text-muted', 3],
  ['--text-dim', null],
] as const
const SIGNALS = ['--accent', '--accent-2', '--warn', '--danger', '--info'] as const
const FILLS = ['--accent-10', '--accent-25', '--accent-45', '--accent-80'] as const
const ARENA = [
  '--arena-bg',
  '--arena-lattice',
  '--arena-ruler',
  '--arena-ip',
  '--arena-exec',
  '--arena-write',
] as const
const HUES = Array.from({ length: 12 }, (_, bot) => `--bot-${bot}`)
const LAYERS = ['--z-ticker', '--z-header', '--z-toast', '--z-modal'] as const

const TOKENS: readonly string[] = [
  ...SURFACES,
  ...LINES,
  ...TEXTS.map(([token]) => token),
  ...SIGNALS,
  ...ARENA,
  ...HUES,
  ...LAYERS,
]

/** The spacing scale (`p-1` … `p-8`), as literal classes. */
const SPACES = [
  ['w-1', 1],
  ['w-2', 2],
  ['w-3', 3],
  ['w-4', 4],
  ['w-6', 6],
  ['w-8', 8],
] as const
const RADII = [
  ['rounded-sm', '--radius-sm', 3],
  ['rounded-md', '--radius-md', 4],
  ['rounded-lg', '--radius-lg', 6],
] as const

/** Each type role (§3): its utility, its name, the color it takes, and a line in its voice. */
const TYPE = [
  ['text-ticker', 'ticker', 'text-text', '▍LIVE · HILL "MAIN" · dwarf-v3 took #1 · 12,480 cycles'],
  ['text-brand', 'brand', 'text-accent', 'asm bots // arena'],
  ['text-nav', 'nav button', 'text-muted', 'tournaments'],
  ['text-panel-title', 'panel title', 'text-accent', 'traffic distribution'],
  ['text-panel-status', 'panel status', 'text-muted', 'loading'],
  ['text-body', 'body', 'text-text', 'Write 8086 assembly. Fight for 64 KB.'],
  ['text-data', 'data cell', 'text-text', '12,480   0x1A2F   7B   add bx, 4'],
  ['text-code', 'code', 'text-text', 'bomb:  mov [bx], ax   ; a zero every 4 bytes'],
  ['text-stat', 'stat number', 'text-bright', '12,480'],
  ['text-modal-title', 'modal title', 'text-bright', 'submit to hill'],
] as const

/** The token sheet: panels for a PanelGrid. `theme` is the one on <html>, to read it again. */
export function TokenSheet({ theme }: { theme: Theme }) {
  const values = useTokens(theme)
  return (
    <>
      <Panel className="col-span-3" title="surfaces · lines" status="5 tokens">
        <div className="flex flex-col gap-2">
          {[...SURFACES, ...LINES].map((token) => (
            <Swatch key={token} token={token} value={values[token]} />
          ))}
        </div>
      </Panel>

      <Panel className="col-span-5" title="text on surfaces" status="wcag ratio · floor">
        <table className="w-full table-fixed border-separate border-spacing-1 text-data">
          <thead>
            <tr>
              <th className="w-28" />
              {SURFACES.map((surface) => (
                <th key={surface} scope="col" className="text-left font-normal text-muted">
                  {surface}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TEXTS.map(([token, floor]) => (
              <tr key={token}>
                <th scope="row" className="text-left font-normal text-text">
                  {token}
                </th>
                {SURFACES.map((surface) => (
                  <Contrast
                    key={surface}
                    token={token}
                    surface={surface}
                    ratio={ratioOf(values[token], values[surface])}
                    floor={floor}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel className="col-span-4" title="accent · signal" status="9 tokens">
        <div className="grid grid-cols-2 gap-2">
          {SIGNALS.map((token) => (
            <Swatch key={token} token={token} value={values[token]} />
          ))}
          {FILLS.map((token) => (
            <Swatch key={token} token={token} value={`accent ${token.slice(-2)}%`} />
          ))}
        </div>
      </Panel>

      <Panel className="col-span-4" title="bot hues" status="the same in every theme">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {HUES.map((token, bot) => (
            <span key={token} className="flex min-w-0 items-center gap-2 text-data">
              <HueSwatch hue={bot} size={14} />
              <Identicon value={`bot-${bot}`} hue={bot} size={16} />
              <span className="w-16 text-text">{token}</span>
              <span className="text-muted">{values[token] || '…'}</span>
            </span>
          ))}
        </div>
      </Panel>

      <Panel className="col-span-8" title="arena" status="black in every theme">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-6">
          <div className="grid grid-cols-2 content-start gap-x-4 gap-y-2">
            {ARENA.map((token) => (
              <Swatch key={token} token={token} value={values[token]} />
            ))}
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <ArenaMock
              theme={theme}
              cell={8}
              origin={HOTSPOT}
              label="the core from 0x5810, 8 px a byte"
              className="h-37 rounded-sm"
            />
            <p className="text-data text-muted">
              8 px a byte: the lattice and the column ruler show from 4x. a copy half written
              flashes white; a process runs with its trail behind it.
            </p>
          </div>
        </div>
      </Panel>

      <Panel
        className="col-span-8"
        title="type scale"
        status="computed · size/line · weight · tracking"
      >
        <TypeScale />
      </Panel>

      <Panel className="col-span-4" title="space · radii · layers" status="§4">
        <div className="flex flex-col gap-4">
          <Group label="space · p-1 … p-8">
            {SPACES.map(([width, step]) => (
              <span key={width} className="flex h-4 items-center gap-2 text-data text-muted">
                <span className="w-6 text-right">{step * 4}</span>
                <span className={cx('h-2 bg-accent-45', width)} />
              </span>
            ))}
          </Group>
          <Group label="radii · sm md lg">
            <div className="flex gap-4">
              {RADII.map(([rounded, token, px]) => (
                <span key={token} className="flex items-center gap-2 text-data text-muted">
                  <span className={cx('size-8 border border-accent bg-accent-10', rounded)} />
                  {px}
                </span>
              ))}
            </div>
          </Group>
          <Group label="layers · z-index">
            {LAYERS.map((token) => (
              <span key={token} className="flex h-5 items-center justify-between gap-2 text-data">
                <span className="text-text">{token.slice(4)}</span>
                <span className="text-muted">{values[token] || '…'}</span>
              </span>
            ))}
          </Group>
        </div>
      </Panel>
    </>
  )
}

/** Every token's value on <html> in `theme`, read after the theme is on the page. */
function useTokens(theme: Theme): Readonly<Record<string, string>> {
  const [values, setValues] = useState<Readonly<Record<string, string>>>({})
  // Read again for each theme: the same names resolve to the new theme's values.
  useEffect(() => {
    const style = getComputedStyle(document.documentElement)
    setValues(
      Object.fromEntries(TOKENS.map((token) => [token, style.getPropertyValue(token).trim()])),
    )
  }, [theme])
  return values
}

/** A captioned part of a panel. */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-panel-status text-muted">{label}</span>
      {children}
    </div>
  )
}

/** A token's color in a box, its name, and its value. */
function Swatch({ token, value }: { token: string; value: string | undefined }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden="true"
        className="size-7 shrink-0 rounded-sm border border-border-strong bg-(--swatch)"
        style={vars({ '--swatch': `var(${token})` })}
      />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-data text-text">{token}</span>
        <span className="truncate text-panel-status text-muted">{value || '…'}</span>
      </span>
    </div>
  )
}

interface ContrastProps {
  token: string
  surface: string
  ratio: number | null
  /** The least ratio the token needs; null for a token the check only reports. */
  floor: number | null
}

/** Sample text in `token` on `surface`, the ratio, and whether it meets the floor. */
function Contrast({ token, surface, ratio, floor }: ContrastProps) {
  const pass = floor === null || (ratio !== null && ratio >= floor)
  return (
    <td
      className="rounded-sm border border-border bg-(--surface) px-2 py-1"
      style={vars({ '--surface': `var(${surface})`, '--ink': `var(${token})` })}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-(--ink)">0x1A2F</span>
        <span className={cx('shrink-0', pass ? 'text-muted' : 'text-danger')}>
          {ratio === null ? '…' : ratio.toFixed(2)}
          {floor !== null && (pass ? ' ✓' : ' ✕')}
        </span>
      </span>
    </td>
  )
}

/** The WCAG ratio of two hex colors, rounded down to 2 places as the contrast check prints it. */
function ratioOf(a: string | undefined, b: string | undefined): number | null {
  const hex = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i
  if (a === undefined || b === undefined || !hex.test(a) || !hex.test(b)) return null
  return Math.floor(contrastRatio(a, b) * 100) / 100
}

/** Each type role in its own type, beside the metrics the browser computes for it. */
function TypeScale() {
  const samples = useRef<(HTMLElement | null)[]>([])
  const [metrics, setMetrics] = useState<readonly string[]>([])
  useEffect(() => {
    setMetrics(
      samples.current.map((node) => (node === null ? '' : metricsOf(getComputedStyle(node)))),
    )
  }, [])
  return (
    <div className="flex flex-col">
      {TYPE.map(([utility, role, color, sample], index) => (
        <div
          key={utility}
          className="grid min-w-0 grid-cols-[6.5rem_15.5rem_minmax(0,1fr)] items-center gap-3 border-b border-border py-1.5 last:border-b-0"
        >
          <span className="text-data text-text">{role}</span>
          <span className="text-data text-muted">{metrics[index] || utility}</span>
          <span
            ref={(node) => {
              samples.current[index] = node
            }}
            className={cx('truncate', utility, color)}
          >
            {sample}
          </span>
        </div>
      ))}
    </div>
  )
}

/** `11/16 · 500 · 0.04em · upper`: a computed style's type metrics. */
function metricsOf(style: CSSStyleDeclaration): string {
  const size = Number.parseFloat(style.fontSize)
  if (!Number.isFinite(size)) return ''
  const line = Number.parseFloat(style.lineHeight)
  const tracking = Number.parseFloat(style.letterSpacing) || 0
  const em = Math.round((tracking / size) * 100) / 100
  const upper = style.textTransform === 'uppercase' ? ' · upper' : ''
  return `${size}/${Number.isFinite(line) ? line : '?'} · ${style.fontWeight} · ${em}em${upper}`
}
