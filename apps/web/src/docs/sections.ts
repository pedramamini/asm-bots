/**
 * What the docs' sections say about themselves beyond their pages: the icon the sidebar and the
 * docs home draw, and one sentence for the home's card. Keyed by the section's title (`nav.ts`,
 * and the generated reference's); the docs tests hold every section to an entry here.
 */
import {
  BookText,
  Cpu,
  History,
  type LucideIcon,
  Rocket,
  Swords,
  Trophy,
  Wrench,
} from 'lucide-react'
import { headingId } from './text'

export interface SectionMeta {
  icon: LucideIcon
  /** One sentence for the section's card on the docs home. */
  summary: string
}

export const SECTION_META: Readonly<Record<string, SectionMeta>> = {
  'start here': {
    icon: Rocket,
    summary: 'What asm bots is, a tour of the app, and a first bot that fights.',
  },
  'the machine': {
    icon: Cpu,
    summary: 'The rules every bot plays by: the core, the processes, death, and the score.',
  },
  'language reference': {
    icon: BookText,
    summary: 'Every instruction and directive, with its encoding, its flags, and an example.',
  },
  'strategy guide': {
    icon: Swords,
    summary: 'The classic families, from imps to vampires, and how each one wins.',
  },
  'tournaments and hills': {
    icon: Trophy,
    summary: 'How rounds, brackets, and hills score, and how a rating moves.',
  },
  tools: {
    icon: Wrench,
    summary: 'The cli, replays, share links, the keys, and the api.',
  },
  changelog: {
    icon: History,
    summary: 'What each release changed, and the versions of the instruction set.',
  },
}

/** A section without an entry: a plain book and no sentence. */
const FALLBACK: SectionMeta = { icon: BookText, summary: '' }

export function sectionMeta(title: string): SectionMeta {
  return SECTION_META[title] ?? FALLBACK
}

/** The anchor of a section's card on the docs home: `the machine` is `#the-machine`. */
export function sectionAnchor(title: string): string {
  return headingId(title)
}
