/**
 * The text of each roster file, by slug: what `loadRoster` assembles, the editor opens, and a
 * replay file carries. The arena loads this module only to write a replay: its bots come prebuilt
 * (`images.ts`).
 */
import decoy from '../roster/decoy.asm' with { type: 'text' }
import dwarf from '../roster/dwarf.asm' with { type: 'text' }
import dwarfWide from '../roster/dwarf-wide.asm' with { type: 'text' }
import gate from '../roster/gate.asm' with { type: 'text' }
import hybrid from '../roster/hybrid.asm' with { type: 'text' }
import imp from '../roster/imp.asm' with { type: 'text' }
import impRing from '../roster/imp-ring.asm' with { type: 'text' }
import painterLcg from '../roster/painter-lcg.asm' with { type: 'text' }
import painterSpiral from '../roster/painter-spiral.asm' with { type: 'text' }
import paper from '../roster/paper.asm' with { type: 'text' }
import scanner from '../roster/scanner.asm' with { type: 'text' }
import silk from '../roster/silk.asm' with { type: 'text' }
import stone from '../roster/stone.asm' with { type: 'text' }
import count from '../roster/test/count.asm' with { type: 'text' }
import divZero from '../roster/test/div-zero.asm' with { type: 'text' }
import halt from '../roster/test/halt.asm' with { type: 'text' }
import misalign from '../roster/test/misalign.asm' with { type: 'text' }
import repCopy from '../roster/test/rep-copy.asm' with { type: 'text' }
import spin from '../roster/test/spin.asm' with { type: 'text' }
import splStorm from '../roster/test/spl-storm.asm' with { type: 'text' }
import stackWalk from '../roster/test/stack-walk.asm' with { type: 'text' }
import vampire from '../roster/vampire.asm' with { type: 'text' }

const SOURCES: Readonly<Record<string, string>> = {
  imp,
  'imp-ring': impRing,
  dwarf,
  'dwarf-wide': dwarfWide,
  gate,
  decoy,
  stone,
  paper,
  silk,
  scanner,
  hybrid,
  vampire,
  'painter-lcg': painterLcg,
  'painter-spiral': painterSpiral,
  halt,
  spin,
  count,
  'spl-storm': splStorm,
  'stack-walk': stackWalk,
  'rep-copy': repCopy,
  'div-zero': divZero,
  misalign,
}

/** The text of roster bot `slug`'s file. Throws for a slug the roster does not have. */
export function rosterSource(slug: string): string {
  const source = SOURCES[slug]
  if (source === undefined) throw new Error(`the roster has no bot '${slug}'`)
  return source
}
