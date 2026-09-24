import { disassemble } from '@asmbots/asm'
import { cx, HueSwatch, hexAddress, hexByte, vars } from '@asmbots/ui'
import { useSyncExternalStore } from 'react'
import { useStore } from 'zustand'
import type { FrameSource } from '../ArenaCanvas'
import { type ArenaScene, NOT_SEEN } from '../render/scene'

/** The tooltip's distance from the pointer, CSS px. */
const OFFSET = 14
/** Room the tooltip takes, CSS px: nearer an edge, it goes to the pointer's other side. */
const ROOM_X = 360
const ROOM_Y = 56
/** The longest instruction, in bytes (ISA §7). */
const MAX_LENGTH = 6

/** What the tooltip says of a byte. */
export interface ByteInfo {
  readonly address: number
  readonly byte: number
  /** The instruction that starts at the byte, as the disassembler writes it. */
  readonly instruction: string
  /** Its owner tag: 0 for nobody, else bot index + 1. */
  readonly tag: number
  /** `owned by Dwarf · written 412 cycles ago`, or `empty core`. */
  readonly story: string
}

const count = (n: number) => n.toLocaleString('en-US')

/**
 * Byte `a` of `scene` as the hover tooltip tells it (DESIGN_SYSTEM §5): the byte, the instruction
 * that starts there, whose it is, and when it was last written, as far as the frames since the
 * last full frame say.
 */
export function byteInfo(scene: ArenaScene, a: number, names: readonly string[]): ByteInfo {
  const bytes = new Uint8Array(MAX_LENGTH)
  for (let k = 0; k < MAX_LENGTH; k++) bytes[k] = scene.bytes[(a + k) & 0xffff] as number
  const instruction = disassemble(bytes, a)[0]?.text ?? ''
  const tag = scene.owner[a] as number
  const at = scene.writtenAt[a] as number
  const ago = scene.cycle - at
  const written =
    at !== NOT_SEEN
      ? `written ${count(ago)} ${ago === 1 ? 'cycle' : 'cycles'} ago`
      : scene.seenSince === 0
        ? 'loaded at cycle 0'
        : `written before cycle ${count(scene.seenSince)}`
  const story = tag === 0 ? 'empty core' : `owned by ${names[tag - 1] ?? `bot ${tag}`} · ${written}`
  return { address: a, byte: bytes[0] as number, instruction, tag, story }
}

export interface HoverTipProps {
  client: FrameSource
  scene: ArenaScene
  /** The byte under the pointer. */
  address: number
  /** The pointer, CSS px from the arena's top-left corner. */
  x: number
  y: number
  /** The arena's size, CSS px. */
  width: number
  height: number
}

/**
 * The tooltip of the byte under a resting pointer (DESIGN_SYSTEM §5): `0x1A2F  7B  add bx, 4`,
 * then `owned by dwarf-v3 · written 412 cycles ago`. It follows the pointer, on the side with
 * room, and reads the byte again with each frame the scene takes (not each the client gets: the
 * scene takes a frame at the next display frame).
 */
export function HoverTip({ client, scene, address, x, y, width, height }: HoverTipProps) {
  // Each frame the scene takes: the byte may change under a pointer that rests.
  useSyncExternalStore(scene.subscribe, () => scene.frameVersion)
  const meta = useStore(client.store, (state) => state.botMeta)
  const info = byteInfo(
    scene,
    address,
    meta.map((bot) => bot.name),
  )
  const left = x + OFFSET + ROOM_X > width
  const up = y + OFFSET + ROOM_Y > height
  return (
    <div
      role="tooltip"
      className={cx(
        'pointer-events-none absolute top-(--y) left-(--x) z-10 w-max max-w-96 rounded-sm border border-border-strong bg-panel px-2 py-1 text-data text-text',
        left && '-translate-x-full',
        up && '-translate-y-full',
      )}
      style={vars({
        '--x': `${left ? x - OFFSET : x + OFFSET}px`,
        '--y': `${up ? y - OFFSET : y + OFFSET}px`,
      })}
    >
      <div className="flex gap-3 whitespace-nowrap">
        <span className="text-bright">{hexAddress(info.address)}</span>
        <span className="text-muted">{hexByte(info.byte)}</span>
        <span className="truncate text-bright">{info.instruction}</span>
      </div>
      <div className="flex items-center gap-1.5 truncate text-muted">
        {info.tag !== 0 && <HueSwatch hue={info.tag - 1} size={8} />}
        {info.story}
      </div>
    </div>
  )
}
