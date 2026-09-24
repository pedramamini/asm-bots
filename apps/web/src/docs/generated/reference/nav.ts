/**
 * The language reference in the docs sidebar. Written by `bun run opcodes`
 * (scripts/gen-reference.ts) with the pages it lists: do not edit.
 */
import type { DocSection } from '../../nav'

export const REFERENCE: DocSection = {
  title: 'language reference',
  pages: [
    {
      slug: 'reference/data',
      file: 'generated/reference/data',
      title: 'data movement',
      blurb: 'mov, lea, xchg, the stack, and the flag loads.',
      load: () => import('./data.mdx'),
    },
    {
      slug: 'reference/arithmetic',
      file: 'generated/reference/arithmetic',
      title: 'arithmetic',
      blurb: 'add, subtract, compare, multiply, divide, and count.',
      load: () => import('./arithmetic.mdx'),
    },
    {
      slug: 'reference/logic',
      file: 'generated/reference/logic',
      title: 'logic',
      blurb: 'and, or, xor, not, and test.',
      load: () => import('./logic.mdx'),
    },
    {
      slug: 'reference/shifts',
      file: 'generated/reference/shifts',
      title: 'shifts and rotates',
      blurb: 'shifts and rotates, by 1 or by cl.',
      load: () => import('./shifts.mdx'),
    },
    {
      slug: 'reference/control',
      file: 'generated/reference/control',
      title: 'control flow',
      blurb: 'jumps, conditions, calls, and loops.',
      load: () => import('./control.mdx'),
    },
    {
      slug: 'reference/string',
      file: 'generated/reference/string',
      title: 'string instructions',
      blurb: 'block copies, fills, and scans, and the rep prefixes.',
      load: () => import('./string.mdx'),
    },
    {
      slug: 'reference/flag-ops',
      file: 'generated/reference/flag-ops',
      title: 'flag instructions',
      blurb: 'clc, stc, cmc, and nop.',
      load: () => import('./flag-ops.mdx'),
    },
    {
      slug: 'reference/process',
      file: 'generated/reference/process',
      title: 'process control',
      blurb: 'dat, spl, hlt, and int3: the asm bots additions.',
      load: () => import('./process.mdx'),
    },
    {
      slug: 'reference/registers',
      file: 'generated/reference/registers',
      title: 'registers',
      blurb: 'the eight general registers, ip, and FLAGS: what each is for.',
      load: () => import('./registers.mdx'),
    },
    {
      slug: 'reference/flags',
      file: 'generated/reference/flags',
      title: 'flags',
      blurb: 'the seven flags: what sets each one, and what reads it.',
      load: () => import('./flags.mdx'),
    },
    {
      slug: 'reference/memory',
      file: 'generated/reference/memory',
      title: 'memory model',
      blurb: 'the 64 KB core, empty core as DAT, ownership, placement, and the base idiom.',
      load: () => import('./memory.mdx'),
    },
    {
      slug: 'reference/addressing',
      file: 'generated/reference/addressing',
      title: 'modr/m addressing',
      blurb: 'memory operands: the 8 base and index forms, and how they encode.',
      load: () => import('./addressing.mdx'),
    },
    {
      slug: 'reference/directives',
      file: 'generated/reference/directives',
      title: 'directives',
      blurb: 'metadata, data, constants, times, align, labels, and size words.',
      load: () => import('./directives.mdx'),
    },
    {
      slug: 'reference/expressions',
      file: 'generated/reference/expressions',
      title: 'expressions',
      blurb: 'numbers, operators, labels, and how values wrap.',
      load: () => import('./expressions.mdx'),
    },
    {
      slug: 'reference/diagnostics',
      file: 'generated/reference/diagnostics',
      title: 'diagnostics',
      blurb: 'every assembler error and linter warning, with an example of each.',
      load: () => import('./diagnostics.mdx'),
    },
    {
      slug: 'reference/divergences',
      file: 'generated/reference/divergences',
      title: '8086 divergences',
      blurb: 'where x16c is not an 8086, and where its assembler is not nasm.',
      load: () => import('./divergences.mdx'),
    },
  ],
}
