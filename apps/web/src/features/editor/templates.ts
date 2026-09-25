/**
 * The templates menu (PRODUCT_SPEC §3): whole bots a new bot starts from, and the base idiom, a
 * snippet that goes in at the cursor. Each template assembles without an error or a warning, and
 * is in the formatter's layout (`test/editor-docs.test.ts`). The toolbar's menu and the new bot's
 * empty state (`EmptyEditor.tsx`) list them.
 */
import { rosterSource } from '@asmbots/bots'

export const TEMPLATE_IDS = ['blank', 'imp', 'dwarf', 'scanner', 'replicator'] as const
export type TemplateId = (typeof TEMPLATE_IDS)[number]

export interface Template {
  readonly id: TemplateId
  /** The menu's label. */
  readonly label: string
  /** What it is, in a few words: the empty state's second column, 28 characters at most. */
  readonly detail: string
}

export const TEMPLATES: readonly Template[] = [
  { id: 'blank', label: 'blank', detail: 'a name, a strategy, a loop' },
  { id: 'imp', label: 'imp', detail: 'roster imp: a movsw runner' },
  { id: 'dwarf', label: 'dwarf', detail: 'roster dwarf: a DAT bomber' },
  { id: 'scanner', label: 'scanner skeleton', detail: 'scan for code, then bomb it' },
  { id: 'replicator', label: 'replicator skeleton', detail: 'copy itself, start each copy' },
]

export function isTemplateId(value: string): value is TemplateId {
  return (TEMPLATE_IDS as readonly string[]).includes(value)
}

const BLANK = `%name     "untitled"
%author   "anonymous"
%strategy "Say in one line how it fights"

start:  jmp     start
`

const SCANNER = `; A scanner skeleton: step down through the core, look at each word, and bomb the first one
; that is not zero. The TODOs are where a real scanner makes its choices.

%name     "my scanner"
%author   "anonymous"
%strategy "Scan for code, bomb what I find"

STEP    equ     8                       ; TODO: bytes between two looks
SIZE    equ     end - start

; Setup: the base idiom puts our base address in bx.
start:  call    .here
.here:  pop     bx
        sub     bx, .here
        mov     si, bx                  ; TODO: where the scan starts

; Scan: step down until a word is not zero.
scan:   sub     si, STEP
        cmp     word [si], 0
        je      scan

; Bomb: skip a hit on our own body, else drop DAT on it and scan on.
        mov     ax, si
        sub     ax, bx                  ; ax = hit - base
        cmp     ax, SIZE
        jb      scan
        mov     word [si], 0            ; TODO: a carpet with rep stosw hits more
        jmp     scan

end:
`

const REPLICATOR = `; A replicator skeleton: copy the body STEP bytes on with rep movsw, start a process in the
; copy with spl, and go on to the next place. Every copy does the same from its own base.

%name     "my replicator"
%author   "anonymous"
%strategy "Copy myself and start every copy"

STEP    equ     0x0800                  ; TODO: bytes from one copy to the next
SIZE    equ     end - start
WORDS   equ     (SIZE + 1) / 2          ; words in a copy

; Setup: the base idiom puts our base address in bx.
start:  call    .here
.here:  pop     bx
        sub     bx, .here
        mov     dx, bx

; Copy: write the body STEP bytes on and start a process there.
copy:   add     dx, STEP
        mov     si, bx
        mov     di, dx
        mov     cx, WORDS
        rep     movsw
        spl     dx
        jmp     copy                    ; TODO: bomb between copies

end:
`

/** A new bot nobody has written in yet: the blank template as it comes, or no text at all. */
export function isBlankBot(source: string): boolean {
  return source.trim() === '' || source === BLANK
}

/** A template's source. */
export function templateSource(id: TemplateId): string {
  switch (id) {
    case 'blank':
      return BLANK
    case 'scanner':
      return SCANNER
    case 'replicator':
      return REPLICATOR
    case 'imp':
    case 'dwarf':
      return rosterSource(id)
  }
}
