/**
 * WebAudio for the sound tests, where neither Bun nor jsdom has any: an `AudioContext` that plays
 * nothing and keeps what the engine asks of it, above all the sources it starts, one or more per
 * cue sounded.
 */

/** An `AudioParam` that takes each change at once and keeps the list. */
export class FakeParam {
  readonly changes: { value: number; time: number }[] = []
  constructor(public value = 0) {}

  setValueAtTime(value: number, time: number): this {
    return this.change(value, time)
  }

  linearRampToValueAtTime(value: number, time: number): this {
    return this.change(value, time)
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    return this.change(value, time)
  }

  setTargetAtTime(value: number, time: number, _constant: number): this {
    return this.change(value, time)
  }

  /** The highest value it was given: an envelope's peak. */
  get peak(): number {
    return Math.max(...this.changes.map((change) => change.value))
  }

  private change(value: number, time: number): this {
    this.changes.push({ value, time })
    this.value = value
    return this
  }
}

class FakeNode {
  readonly outputs: FakeNode[] = []
  connect<T extends FakeNode>(node: T): T {
    this.outputs.push(node)
    return node
  }
}

/** An oscillator or a buffer source: `start` puts it on the context's list. */
export class FakeSource extends FakeNode {
  startedAt: number | null = null
  stoppedAt: number | null = null
  constructor(private readonly context: FakeAudioContext) {
    super()
  }

  start(at = 0): void {
    this.startedAt = at
    this.context.started.push(this)
  }

  stop(at = 0): void {
    this.stoppedAt = at
  }
}

export class FakeOscillator extends FakeSource {
  type: OscillatorType = 'sine'
  readonly frequency = new FakeParam(440)
}

export class FakeBufferSource extends FakeSource {
  buffer: unknown = null
}

export class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1)
}

export class FakeAudioContext {
  currentTime = 0
  readonly sampleRate = 48_000
  readonly destination = new FakeNode()
  /** Every source started, in order. */
  readonly started: FakeSource[] = []
  /** Every gain made, in order: the master's first. */
  readonly gains: FakeGain[] = []

  /** `suspended`: a context the browser has not started yet; `resume` starts it a moment later. */
  constructor(public state: AudioContextState = 'running') {}

  createGain(): FakeGain {
    const gain = new FakeGain()
    this.gains.push(gain)
    return gain
  }

  createOscillator(): FakeOscillator {
    return new FakeOscillator(this)
  }

  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource(this)
  }

  createBiquadFilter() {
    return Object.assign(new FakeNode(), {
      type: 'lowpass',
      frequency: new FakeParam(350),
      Q: new FakeParam(1),
    })
  }

  createDynamicsCompressor() {
    return Object.assign(new FakeNode(), {
      threshold: new FakeParam(-24),
      ratio: new FakeParam(12),
    })
  }

  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length)
    return { length, sampleRate, getChannelData: () => data }
  }

  resume(): Promise<void> {
    return Promise.resolve().then(() => {
      if (this.state !== 'closed') this.state = 'running'
    })
  }

  suspend(): Promise<void> {
    this.state = 'suspended'
    return Promise.resolve()
  }

  close(): Promise<void> {
    this.state = 'closed'
    return Promise.resolve()
  }

  /** The oscillators started, in order. */
  oscillators(): FakeOscillator[] {
    return this.started.filter(
      (source): source is FakeOscillator => source instanceof FakeOscillator,
    )
  }
}

/** A context factory for `SoundEngine`, and the contexts it made. */
export function fakeContexts(state: AudioContextState = 'running') {
  const made: FakeAudioContext[] = []
  const createContext = () => {
    const context = new FakeAudioContext(state)
    made.push(context)
    return context as unknown as AudioContext
  }
  return { made, createContext }
}
