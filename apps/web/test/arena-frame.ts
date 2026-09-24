/** Frames for the arena tests that make their own, not a session's. */
import type { FrameMessage } from '../src/features/arena/worker/protocol'

/** A frame with nothing in it but what `parts` gives: cycle 0, two bots alive. */
export function emptyFrame(parts: Partial<FrameMessage> = {}): FrameMessage {
  return {
    type: 'frame',
    cycle: 0,
    alive: 2,
    over: false,
    writes: new Uint16Array(0),
    writeCycles: new Uint32Array(0),
    execs: new Uint16Array(0),
    ips: new Uint16Array(0),
    spawns: new Uint32Array(0),
    deaths: new Uint32Array(0),
    botDeaths: new Uint32Array(0),
    stats: new Float32Array(0),
    firstBlood: null,
    keyframes: null,
    ownerDirty: null,
    bytesDirty: null,
    ...parts,
  }
}
