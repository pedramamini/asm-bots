/**
 * The reference card of a mnemonic or a prefix (opcodes.ts): its name and spellings, what it does,
 * its encoding forms, what it does to FLAGS, and an example with its bytes. The editor shows it on
 * hover and beside a completion. CodeMirror mounts both, so this is plain DOM; the theme's
 * `.cm-x16c-card` rules (x16c.ts) style it.
 */
import { FAMILY_NAMES, FLAG_NAMES, type OpcodeEntry, opcodeEntry } from './opcodes'

/** An element of the card: `part` names its class, `cm-x16c-card-<part>`. */
function el(tag: string, part: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = `cm-x16c-card-${part}`
  if (text !== undefined) node.textContent = text
  return node
}

/** A titled section: a hairline, an uppercase label, and its body. */
function section(label: string, body: HTMLElement): HTMLElement {
  const node = el('section', 'section')
  node.append(el('div', 'label', label), body)
  return node
}

/** Two columns, code and bytes, as a listing shows them. */
function rows(pairs: readonly (readonly [code: string, bytes: string])[]): HTMLElement {
  const grid = el('div', 'rows')
  for (const [code, bytes] of pairs) {
    grid.append(el('span', 'code', code), el('span', 'bytes', bytes))
  }
  return grid
}

const EFFECTS: Readonly<Record<string, string>> = {
  '*': 'from the result',
  '0': 'cleared',
  '1': 'set',
}

/**
 * FLAGS as `O D I T S Z A P C`, each over what the instruction does to it: `-` nothing, `*` set from
 * the result, `0` or `1` forced. A flag it changes is lit. Read aloud, it is the changed flags.
 */
function flagGrid(flags: string): HTMLElement {
  const grid = el('div', 'flags')
  const effects = [...FLAG_NAMES].map((name, k) => [name, flags[k] ?? '-'] as const)
  const cell = (text: string, effect: string) => {
    const node = el('span', 'flag', text)
    if (effect !== '-') node.dataset.on = ''
    return node
  }
  for (const [name, effect] of effects) grid.append(cell(name, effect))
  for (const [, effect] of effects) grid.append(cell(effect, effect))
  const changed = effects.filter(([, e]) => e !== '-').map(([name, e]) => `${name} ${EFFECTS[e]}`)
  grid.setAttribute('role', 'img')
  grid.setAttribute('aria-label', changed.length === 0 ? 'no flag changes' : changed.join(', '))
  return grid
}

/** The card of `entry`. */
export function opcodeCard(entry: OpcodeEntry): HTMLElement {
  const card = document.createElement('div')
  card.className = 'cm-x16c-card'
  const { doc } = entry

  const head = el('div', 'head')
  head.append(el('span', 'name', entry.name))
  if (doc.aliases.length > 0) head.append(el('span', 'aliases', doc.aliases.join(' ')))
  const family = entry.kind === 'prefix' ? 'prefix' : (FAMILY_NAMES[entry.doc.family] ?? '')
  head.append(el('span', 'family', family))
  card.append(head, el('p', 'summary', doc.summary))

  if (entry.kind === 'mnemonic') {
    if (entry.doc.kills) card.append(el('p', 'kills', 'running it kills the process'))
    card.append(section('forms', rows(entry.doc.forms.map((f) => [f.syntax, f.encoding]))))
    card.append(section('flags', flagGrid(entry.doc.flags)))
  } else {
    // The forms it makes, from each instruction's own list: `rep movsw  F3 A5`.
    const forms = entry.doc.takes.flatMap((m) => {
      const target = opcodeEntry(m)
      const syntax = `${entry.name} ${m}`
      const form =
        target?.kind === 'mnemonic' ? target.doc.forms.find((f) => f.syntax === syntax) : undefined
      return form === undefined ? [] : [[form.syntax, form.encoding] as const]
    })
    card.append(section('forms', rows(forms)))
  }
  card.append(section('example', rows(doc.example.map((l) => [l.source, l.bytes]))))
  return card
}
