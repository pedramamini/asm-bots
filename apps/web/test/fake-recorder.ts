/** A `MediaRecorder` and streaming canvases for the arena video's jsdom tests, which have neither. */

/** A recorder that records nothing: at `stop`, one chunk of `video/mp4`, then `stop`. */
export class FakeRecorder extends EventTarget {
  /** The recorders made, in order. */
  static made: FakeRecorder[] = []
  /** The types this browser records: MP4 unless a test says otherwise. */
  static supported = (mime: string) => mime.startsWith('video/mp4')
  static isTypeSupported(mime: string): boolean {
    return FakeRecorder.supported(mime)
  }

  state: RecordingState = 'inactive'
  timeslice: number | undefined

  constructor(
    readonly stream: MediaStream,
    readonly options: MediaRecorderOptions = {},
  ) {
    super()
    FakeRecorder.made.push(this)
  }

  start(timeslice?: number): void {
    this.state = 'recording'
    this.timeslice = timeslice
  }

  stop(): void {
    this.state = 'inactive'
    queueMicrotask(() => {
      const data = new Event('dataavailable')
      Object.defineProperty(data, 'data', { value: new Blob(['video'], { type: 'video/mp4' }) })
      this.dispatchEvent(data)
      this.dispatchEvent(new Event('stop'))
    })
  }
}

/** The tracks the fake streams made, and whether each stopped. */
export const tracks: { stopped: boolean }[] = []

/**
 * Gives the global object `FakeRecorder` as its `MediaRecorder`, and the canvases of `window` a
 * `captureStream`. Returns what puts both back.
 */
export function stubRecorder(window: { HTMLCanvasElement: typeof HTMLCanvasElement }): () => void {
  const global = globalThis as { MediaRecorder?: unknown }
  const recorder = global.MediaRecorder
  const proto = window.HTMLCanvasElement.prototype
  const captureStream = Object.getOwnPropertyDescriptor(proto, 'captureStream')
  global.MediaRecorder = FakeRecorder
  proto.captureStream = function (this: HTMLCanvasElement) {
    const track = {
      stopped: false,
      stop() {
        this.stopped = true
      },
    }
    tracks.push(track)
    return { getTracks: () => [track] } as unknown as MediaStream
  }
  return () => {
    FakeRecorder.made = []
    tracks.length = 0
    if (recorder === undefined) Reflect.deleteProperty(global, 'MediaRecorder')
    else global.MediaRecorder = recorder
    if (captureStream === undefined) Reflect.deleteProperty(proto, 'captureStream')
    else Object.defineProperty(proto, 'captureStream', captureStream)
  }
}
