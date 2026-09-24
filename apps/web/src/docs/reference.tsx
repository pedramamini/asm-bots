/**
 * The docs' instruction diagrams, from the reference the editor's hover cards read
 * (`docs/opcodes.json`): `Encoding`, an instruction form's bytes, and `Flags`, the ODITSZAPC row
 * with the flags an instruction changes lit.
 */
import { cx } from '@asmbots/ui'
import { FLAG_NAMES, type MnemonicDoc, opcodeEntry } from '../features/editor/cm/opcodes'

/** One field of an encoding: a byte, or the ModR/M byte's three fields, or an optional run. */
export interface EncodingField {
  kind: 'opcode' | 'modrm' | 'disp' | 'imm' | 'rel'
  /** What the field holds: `C7`, `B8+r`, `lo`, `disp8/16`. */
  value: string
  /** Under the field: `opcode`, `imm16 lo`. */
  label: string
  /** Its size in bytes: the displacement is 0 to 2. */
  bytes: readonly [min: number, max: number]
  /** The ModR/M byte's `reg` field: `reg`, or the opcode extension in binary, `000`. */
  reg?: string
}

/** The fields of an ISA §3 encoding: `C7 /0 iw` is the opcode, ModR/M, its displacement, imm16. */
export function encodingFields(encoding: string): EncodingField[] {
  const fields: EncodingField[] = []
  const pair = (kind: 'imm' | 'rel', name: string) => {
    fields.push({ kind, value: 'lo', label: `${name} lo`, bytes: [1, 1] })
    fields.push({ kind, value: 'hi', label: `${name} hi`, bytes: [1, 1] })
  }
  for (const part of encoding.split(/\s+/)) {
    const opcode = /^([0-9A-F]{2})(\+r)?$/.exec(part)
    const extension = /^\/([0-7r])$/.exec(part)
    if (opcode !== null) {
      fields.push({
        kind: 'opcode',
        value: part,
        label: opcode[2] === undefined ? 'opcode' : 'opcode + reg',
        bytes: [1, 1],
      })
    } else if (extension !== null) {
      const n = extension[1] as string
      fields.push({
        kind: 'modrm',
        value: 'ModR/M',
        label: n === 'r' ? 'ModR/M' : `ModR/M · /${n}`,
        bytes: [1, 1],
        reg: n === 'r' ? 'reg' : Number(n).toString(2).padStart(3, '0'),
      })
      fields.push({ kind: 'disp', value: 'disp8/16', label: 'by mod', bytes: [0, 2] })
    } else if (part === 'ib') {
      fields.push({ kind: 'imm', value: 'imm8', label: 'imm8', bytes: [1, 1] })
    } else if (part === 'iw') {
      pair('imm', 'imm16')
    } else if (part === 'cb') {
      fields.push({ kind: 'rel', value: 'rel8', label: 'rel8', bytes: [1, 1] })
    } else if (part === 'cw') {
      pair('rel', 'rel16')
    } else {
      throw new Error(`no encoding field "${part}" in "${encoding}"`)
    }
  }
  return fields
}

/** The mnemonic's entry, or an error that names the MDX's mistake. */
function mnemonicDoc(name: string): MnemonicDoc {
  const entry = opcodeEntry(name)
  if (entry?.kind !== 'mnemonic') throw new Error(`no mnemonic "${name}" in docs/opcodes.json`)
  return entry.doc
}

/** A form of `docs/opcodes.json` by its syntax (`mov r/m16, imm16`), with its encoding. */
export function findForm(syntax: string): { syntax: string; encoding: string } {
  const doc = mnemonicDoc(syntax.split(/\s+/)[0] ?? '')
  const form = doc.forms.find((f) => f.syntax === syntax.trim())
  if (form === undefined) {
    throw new Error(
      `no form "${syntax}" in docs/opcodes.json: try ${doc.forms.map((f) => `"${f.syntax}"`).join(', ')}`,
    )
  }
  return form
}

const FIELD_COLOR: Readonly<Record<EncodingField['kind'], string>> = {
  opcode: 'border-accent-45 text-accent',
  modrm: 'border-border-strong text-bright',
  disp: 'border-dashed border-border-strong text-muted',
  imm: 'border-border-strong text-info',
  rel: 'border-border-strong text-info',
}

/**
 * An instruction form's bytes, left to right as they sit in memory: `<Encoding form="mov r/m16,
 * imm16" />` draws `C7`, the ModR/M byte (mod, `/0`, r/m), the displacement its mod asks for, and
 * the immediate, low byte first.
 */
export function Encoding({ form }: { form: string }) {
  const { syntax, encoding } = findForm(form)
  const fields = encodingFields(encoding)
  const min = fields.reduce((sum, f) => sum + f.bytes[0], 0)
  const max = fields.reduce((sum, f) => sum + f.bytes[1], 0)
  const size = min === max ? `${min} ${min === 1 ? 'byte' : 'bytes'}` : `${min} to ${max} bytes`
  return (
    <figure aria-label={`encoding of ${syntax}`} className="my-3 min-w-0">
      <div className="flex overflow-x-auto pb-1">
        {fields.map((field, at) => (
          <div key={at} className="flex shrink-0 flex-col items-stretch gap-1 [&+&]:-ml-px">
            <div
              className={cx(
                'flex h-8 min-w-12 items-center justify-center border bg-panel-2 px-2 text-code',
                FIELD_COLOR[field.kind],
              )}
            >
              {field.kind === 'modrm' ? (
                <span className="flex gap-2">
                  <span className="text-dim">mod</span>
                  <span className={field.reg === 'reg' ? 'text-dim' : 'text-accent'}>
                    {field.reg}
                  </span>
                  <span className="text-dim">r/m</span>
                </span>
              ) : (
                field.value
              )}
            </div>
            <span className="px-1.5 text-center whitespace-nowrap text-panel-status text-dim">
              {field.label}
            </span>
          </div>
        ))}
      </div>
      <figcaption className="mt-1 text-data text-muted">
        <code className="text-bright">{syntax}</code> · {encoding} · {size}
      </figcaption>
    </figure>
  )
}

const FLAG_TITLES: Readonly<Record<string, string>> = {
  O: 'overflow',
  D: 'direction',
  I: 'interrupt',
  T: 'trap',
  S: 'sign',
  Z: 'zero',
  A: 'auxiliary carry',
  P: 'parity',
  C: 'carry',
}

const EFFECT: Readonly<Record<string, string>> = {
  '-': 'unchanged',
  '*': 'from the result',
  '0': 'cleared',
  '1': 'set',
}

/**
 * The flags row, ODITSZAPC, with the flags that change lit: `<Flags op="add" />` from the
 * reference (`*` from the result, `0` cleared, `1` set), or `<Flags set="CZ" />` by name.
 */
export function Flags({ op, set }: { op?: string; set?: string }) {
  const effects =
    op !== undefined
      ? mnemonicDoc(op).flags
      : [...FLAG_NAMES].map((flag) => (set?.toUpperCase().includes(flag) ? '*' : '-')).join('')
  return (
    <table className="my-3 border-collapse text-center text-code">
      <caption className="mb-1 text-left text-panel-status text-muted">
        {op === undefined ? 'flags' : `flags · ${op}`}
      </caption>
      <thead>
        <tr>
          {[...FLAG_NAMES].map((flag, at) => {
            const on = effects[at] !== '-'
            return (
              <th
                key={flag}
                scope="col"
                title={FLAG_TITLES[flag]}
                className={cx(
                  'w-8 border px-1 font-semibold',
                  on ? 'border-accent-45 bg-accent-10 text-accent' : 'border-border text-dim',
                )}
              >
                {flag}
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        <tr>
          {[...effects].map((effect, at) => (
            <td
              key={at}
              title={EFFECT[effect]}
              className={cx(
                'border border-border px-1',
                effect === '-' ? 'text-dim' : 'text-bright',
              )}
            >
              {effect}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  )
}
