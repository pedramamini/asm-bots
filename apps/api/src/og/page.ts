/**
 * The share card of a page with no data of its own (PRODUCT_SPEC §10): the home page, the arena,
 * the docs, a profile. The brand and the page's label, its headline, its description, and the
 * footer, as the web build's manifest (`/meta/pages.json`) gives them.
 */
import { CARD_WIDTH } from '@asmbots/protocol'
import { brand, card, fits, footer, MARGIN, SENTINEL, text, wrap } from './card'

const WIDTH = CARD_WIDTH - 2 * MARGIN
const HEADLINE = 64
const HEADLINE_STEP = 76
const HEADLINE_Y = 204
const DESCRIPTION = 28
const DESCRIPTION_STEP = 40

/** What a page card shows: a manifest page's words. */
export interface PageCardInput {
  /** After the brand: `docs`; empty for the brand alone. */
  readonly label: string
  readonly headline: string
  readonly description: string
}

/** The card of a page; `host` signs it. */
export function pageCard({ label, headline, description }: PageCardInput, host: string): string {
  const heading = wrap(headline, fits(WIDTH, HEADLINE), 2)
  const below = HEADLINE_Y + (heading.length - 1) * HEADLINE_STEP + 68
  const lines = wrap(description, fits(WIDTH, DESCRIPTION), 3)
  return card(`ASM BOTS: ${headline}`, [
    brand(MARGIN, 96, label),
    ...heading.map(
      (line, i) =>
        `<text x="${MARGIN}" y="${HEADLINE_Y + i * HEADLINE_STEP}" fill="${SENTINEL.bright}" font-size="${HEADLINE}" font-weight="700">${text(line)}</text>`,
    ),
    ...lines.map(
      (line, i) =>
        `<text x="${MARGIN}" y="${below + i * DESCRIPTION_STEP}" fill="${SENTINEL.text}" font-size="${DESCRIPTION}">${text(line)}</text>`,
    ),
    footer(host),
  ])
}
