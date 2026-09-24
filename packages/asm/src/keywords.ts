import {
  ALIASES,
  MNEMONICS,
  PREFIX_ALIASES,
  PREFIX_BYTE,
  REG8_NAMES,
  REG16_NAMES,
  TABLE,
} from '@asmbots/codec'
import type { RegName, Size } from './ast'

/*
 * Reserved words, all lowercase: the source may use any case. Mnemonics, prefixes, and the
 * registers come from the codec, so the parser holds no instruction knowledge of its own.
 */

const REGISTERS: ReadonlySet<string> = new Set<string>([...REG16_NAMES, ...REG8_NAMES])

export function isRegister(word: string): word is RegName {
  return REGISTERS.has(word)
}

export const BYTE_REGISTERS: ReadonlySet<string> = new Set<string>(REG8_NAMES)

export const SIZES: ReadonlyMap<string, Size> = new Map([
  ['byte', 8],
  ['word', 16],
])

/** Canonical mnemonics and their aliases (`je`, `sal`, `loopz`, ...). */
export const MNEMONIC_WORDS: ReadonlySet<string> = new Set<string>([
  ...MNEMONICS,
  ...ALIASES.keys(),
])

const REL_MNEMONICS: ReadonlySet<string> = new Set(
  TABLE.filter((r) => r.operands.some((t) => t === 'rel8' || t === 'rel16')).map((r) => r.mnemonic),
)

/** Mnemonics whose plain operand is an address to go to: jumps, `call`, `loop`, `spl`. */
export const TARGET_WORDS: ReadonlySet<string> = new Set(
  [...MNEMONIC_WORDS].filter((m) => REL_MNEMONICS.has(ALIASES.get(m) ?? m)),
)

export const PREFIX_WORDS: ReadonlySet<string> = new Set<string>([
  ...Object.keys(PREFIX_BYTE),
  ...PREFIX_ALIASES.keys(),
])

export const DATA_WORDS: ReadonlySet<string> = new Set(['db', 'dw', 'resb', 'resw'])
export const DIRECTIVE_WORDS: ReadonlySet<string> = new Set(['org', 'bits', 'align'])

/** Metadata directives (ISA §6.2). Each takes one quoted string. */
export const META_WORDS: ReadonlySet<string> = new Set([
  '%name',
  '%author',
  '%strategy',
  '%version',
])

/** Words that start a statement, so a word before one is a label even without a colon. */
export function startsStatement(word: string): boolean {
  return (
    MNEMONIC_WORDS.has(word) ||
    PREFIX_WORDS.has(word) ||
    DATA_WORDS.has(word) ||
    DIRECTIVE_WORDS.has(word) ||
    word === 'equ' ||
    word === 'times'
  )
}

const SEGMENTS = 'segment registers are not supported: x16c has one flat 64 KB address space'
const wide = (r: string) => `\`${r}\` is a 32-bit register; the 8086 has 16-bit and 8-bit ones`
const noSize = (w: string) => `\`${w}\` is not supported: operands are byte or word`
const noData = (w: string) => `\`${w}\` is not supported: data is db or dw, space is resb or resw`
const noLinker = (w: string) => `\`${w}\` is not supported: a bot is one file, with no linker`
const SECTIONS = 'sections are not supported: a bot is one block of code and data'

/** NASM words that x16c leaves out (ISA §6.2), with the error to give. */
export const UNSUPPORTED: ReadonlyMap<string, string> = new Map([
  ...['cs', 'ds', 'es', 'ss', 'fs', 'gs'].map((r) => [r, SEGMENTS] as const),
  ...['eax', 'ebx', 'ecx', 'edx', 'esi', 'edi', 'ebp', 'esp'].map((r) => [r, wide(r)] as const),
  ['far', 'far jumps and pointers are not supported: x16c has no segments'],
  ['seg', '`seg` is not supported: x16c has no segments'],
  ...['dword', 'qword', 'tword'].map((w) => [w, noSize(w)] as const),
  ...['dd', 'dq', 'dt', 'resd', 'resq', 'rest'].map((w) => [w, noData(w)] as const),
  ['section', SECTIONS],
  ['segment', SECTIONS],
  ...['extern', 'global', 'common'].map((w) => [w, noLinker(w)] as const),
  ['incbin', '`incbin` is not supported: a bot is one file'],
  ['lock', '`lock` is not supported: the prefixes are rep, repe, and repne'],
])

/** The words that pin the size of a jump or an immediate field. */
const MODIFIERS = ['short', 'near', 'strict'] as const

const KEYWORDS: ReadonlySet<string> = new Set([...MODIFIERS, 'equ', 'times'])

/** Words that cannot be labels, and that an expression cannot name. */
export function isReserved(word: string): boolean {
  return (
    REGISTERS.has(word) ||
    SIZES.has(word) ||
    KEYWORDS.has(word) ||
    DATA_WORDS.has(word) ||
    DIRECTIVE_WORDS.has(word) ||
    UNSUPPORTED.has(word)
  )
}

/** The error for a `%` directive other than `%define` and the metadata ones. */
export function unsupportedDirective(text: string): string {
  const word = text.toLowerCase()
  if (/^%(i?r?macro|endmacro)$/.test(word)) {
    return 'multi-line macros are not supported; `%define` makes one-line text macros'
  }
  if (/^%(rep|endrep|exitrep)$/.test(word)) return `\`${text}\` is not supported; use \`times\``
  if (/^%(if|elif)/.test(word) || word === '%else' || word === '%endif') {
    return 'conditional assembly is not supported'
  }
  if (word === '%include' || word === '%use') {
    return `\`${text}\` is not supported: a bot is one file`
  }
  return `unknown directive \`${text}\`; the directives are %define, %name, %author, %strategy, and %version`
}

/**
 * The dialect's words by class, all lowercase (source may use any case): what a tool needs to
 * color or complete source without parsing it, as the editor does. `sizes` are `byte` and `word`
 * and the words that pin a size (`short`, `near`, `strict`); `directives` are the statement words
 * that are not instructions; `percent` are the `%` directives; `targets` are the mnemonics whose
 * plain operand is an address to go to.
 */
export const WORDS: Readonly<{
  mnemonics: ReadonlySet<string>
  prefixes: ReadonlySet<string>
  registers: ReadonlySet<string>
  sizes: ReadonlySet<string>
  directives: ReadonlySet<string>
  percent: ReadonlySet<string>
  targets: ReadonlySet<string>
}> = Object.freeze({
  mnemonics: MNEMONIC_WORDS,
  prefixes: PREFIX_WORDS,
  registers: REGISTERS,
  sizes: new Set([...SIZES.keys(), ...MODIFIERS]),
  directives: new Set([...DATA_WORDS, ...DIRECTIVE_WORDS, 'equ', 'times']),
  percent: new Set(['%define', ...META_WORDS]),
  targets: TARGET_WORDS,
})
