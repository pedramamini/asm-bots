/**
 * A tournament's downloads (PRODUCT_SPEC §4): `results.json`, every match with its rounds; a
 * bracket's `bracket.svg`, drawn in the page's theme; a round robin's or a melee's standings CSV.
 */
import { type BracketPalette, bracketSvg, csv, DEFAULT_BRACKET_PALETTE } from '@asmbots/tourney'
import { downloadBlob, slug } from '../arena/battle/files'
import type { Tournament } from './store'

/** The CSS custom property each palette color reads. */
const PALETTE_TOKENS: Readonly<Record<keyof BracketPalette, `--${string}`>> = {
  background: '--panel',
  node: '--panel-2',
  border: '--border-strong',
  line: '--border-strong',
  text: '--text',
  muted: '--text-muted',
  dim: '--text-dim',
  bright: '--text-bright',
  accent: '--accent',
}

/**
 * The bracket palette of the page's theme, as the tokens resolve on `<html>`. A token that does
 * not resolve (no stylesheet, as in a test) keeps the default's color.
 */
export function themePalette(root: Element = document.documentElement): BracketPalette {
  const style = getComputedStyle(root)
  const palette = { ...DEFAULT_BRACKET_PALETTE }
  for (const [key, token] of Object.entries(PALETTE_TOKENS) as [keyof BracketPalette, string][]) {
    const value = style.getPropertyValue(token).trim()
    if (value !== '') palette[key] = value
  }
  return palette
}

/** `results.json`: the tournament as it stands, the local bots' sources left out. */
export function resultsJson(t: Tournament): string {
  const champion = t.champion === null ? null : (t.entrants[t.champion]?.name ?? null)
  const results = {
    format: 'asmbots-tournament',
    version: 1,
    name: t.name,
    kind: t.kind,
    status: t.status,
    config: t.config,
    rounds: t.rounds,
    entrants: t.entrants.map(({ source, ref, name }) => ({ source, ref, name })),
    champion,
    progress: t.progress,
    standings: t.standings ?? null,
    bracket: t.bracket ?? null,
    matches: t.matches,
  }
  return `${JSON.stringify(results, null, 2)}\n`
}

/** `asmbots-<name>`: the stem of a tournament's files. */
function stem(t: Tournament): string {
  return `asmbots-${slug(t.name) || 'tournament'}`
}

export function downloadResults(t: Tournament): void {
  const blob = new Blob([resultsJson(t)], { type: 'application/json' })
  downloadBlob(blob, `${stem(t)}-results.json`)
}

/** Saves the standings as they stand, ranked, as CSV. Nothing without standings. */
export function downloadStandings(t: Tournament): void {
  if (t.standings === undefined) return
  const blob = new Blob([csv(t.standings)], { type: 'text/csv' })
  downloadBlob(blob, `${stem(t)}-standings.csv`)
}

/** Saves the bracket as drawn, in the page's theme. Nothing without a bracket. */
export function downloadBracket(t: Tournament): void {
  if (t.bracket === undefined) return
  const svg = bracketSvg(t.bracket, { palette: themePalette(), title: t.name })
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${stem(t)}-bracket.svg`)
}
