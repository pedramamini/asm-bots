/**
 * The arena's video (`v`, and `share ▾`'s `export video`): each display frame of the arena, in its
 * theme, with the screenshot's words on it (the HUD's chips, the bots' legend, and the footer
 * stamp, the cycle counting up), recorded by the browser's `MediaRecorder` to an MP4, or a WebM
 * where the browser makes no MP4. The video runs in real time, at the speed the arena plays.
 */
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import type { ArenaCanvasHandle } from '../ArenaCanvas'
import type { ArenaClient } from '../worker/client'
import { downloadBlob } from './files'
import { paintShot, readPalette, type ScreenshotText, shotLayout } from './screenshot'

/** A container and codec the browser can record to. */
export interface VideoFormat {
  /** What `MediaRecorder` records: `video/mp4;codecs=avc1.640033`. */
  readonly mime: string
  /** The file's type: `video/mp4`. */
  readonly type: string
  readonly extension: 'mp4' | 'webm'
}

/** Best first: an MP4 (H.264) plays wherever a video is shared; WebM where there is none. */
const FORMATS: readonly VideoFormat[] = [
  // High profile, level 5.1: a frame to 4096 x 2304, past what `MAX_WIDTH` lets through.
  { mime: 'video/mp4;codecs=avc1.640033', type: 'video/mp4', extension: 'mp4' },
  { mime: 'video/mp4', type: 'video/mp4', extension: 'mp4' },
  { mime: 'video/webm;codecs=vp9', type: 'video/webm', extension: 'webm' },
  { mime: 'video/webm;codecs=vp8', type: 'video/webm', extension: 'webm' },
  { mime: 'video/webm', type: 'video/webm', extension: 'webm' },
]

/** The widest video, px: past it, the arena is scaled down. */
export const MAX_WIDTH = 1920
/** The frames a second the video takes at most: one per display frame. */
const FPS = 60
/** Enough for the core's fine grain to stay sharp. */
const BITRATE = 8_000_000
/** How long a recording runs on after the end, ms: the end stays on screen a moment. */
export const TAIL_MS = 1200

/** The format to record in: the first of `FORMATS` that `supported` takes. Null: none. */
export function videoFormat(supported?: (mime: string) => boolean): VideoFormat | null {
  const test =
    supported ??
    (typeof MediaRecorder === 'function'
      ? (mime: string) => MediaRecorder.isTypeSupported(mime)
      : null)
  if (test === null) return null
  return FORMATS.find((format) => test(format.mime)) ?? null
}

/** Whether this browser can record the arena: a `MediaRecorder`, and canvases that stream. */
export function canRecordVideo(): boolean {
  return (
    typeof HTMLCanvasElement === 'function' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    videoFormat() !== null
  )
}

/** A recording under way. */
export interface ArenaRecording {
  readonly format: VideoFormat
  /** Stops it. Resolves with the video, or null where it recorded nothing. */
  stop(): Promise<Blob | null>
}

/**
 * Records the arena of `handle` from its next frame on, `text()` on each frame. The video's size
 * is set now, from the arena's: a resize later fits the arena into it. Null where the browser
 * cannot record, or the arena has no canvas yet.
 */
export function recordArena(
  handle: ArenaCanvasHandle,
  text: () => ScreenshotText,
): ArenaRecording | null {
  const format = videoFormat()
  const source = handle.canvas
  if (format === null || source === null || handle.renderer === null) return null
  const frame = document.createElement('canvas')
  if (typeof frame.captureStream !== 'function') return null
  const probe = frame.getContext('2d')
  if (probe === null) return null
  const layout = shotLayout(probe, source, text().bots, { maxWidth: MAX_WIDTH, even: true })
  frame.width = layout.pixelWidth
  frame.height = layout.pixelHeight
  // A new size resets the context.
  const ctx = frame.getContext('2d') as CanvasRenderingContext2D
  const palette = readPalette()
  const stream = frame.captureStream(FPS)
  const release = () => {
    for (const track of stream.getTracks()) track.stop()
  }
  let recorder: MediaRecorder
  try {
    recorder = new MediaRecorder(stream, { mimeType: format.mime, videoBitsPerSecond: BITRATE })
  } catch {
    release()
    return null
  }
  const chunks: Blob[] = []
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  })
  const off = handle.onDraw((canvas, overlay) =>
    paintShot(ctx, layout, canvas, overlay, text(), palette),
  )
  // A chunk a second: a long battle's video is not one buffer held to the end.
  recorder.start(1000)
  return {
    format,
    stop: () =>
      new Promise((resolve) => {
        off()
        const done = () => {
          release()
          resolve(chunks.length === 0 ? null : new Blob(chunks, { type: format.type }))
        }
        if (recorder.state === 'inactive') {
          done()
          return
        }
        recorder.addEventListener('stop', done, { once: true })
        recorder.stop()
      }),
  }
}

export interface ArenaVideoOptions {
  client: Pick<ArenaClient, 'store' | 'pause' | 'play' | 'seek'>
  canvas: RefObject<ArenaCanvasHandle | null>
  /** The words on the frame now: the screenshot's. */
  text: () => ScreenshotText
  /** The video's file name, by its extension. */
  fileName: (extension: string) => string
  /** Says what went wrong: the browser cannot record, or recorded nothing. */
  onFail: (message: string) => void
}

/** The arena's video, for the HUD, the keys, and `share ▾`. */
export interface ArenaVideo {
  /** When the recording started (`performance.now()`), or null when none is under way. */
  readonly since: number | null
  /** Starts recording what the arena shows, or stops and saves the video: `v`. */
  toggle(): void
  /** Records the round from cycle 0 to its end, and saves it: `export video`. */
  exportRound(): void
}

/**
 * The arena's video recorder. A recording stops and saves a moment (`TAIL_MS`) after the match
 * ends, or the round, for `exportRound`; `toggle` stops it sooner. Leaving the battle saves what
 * was recorded.
 */
export function useArenaVideo(options: ArenaVideoOptions): ArenaVideo {
  const latest = useRef(options)
  latest.current = options
  const { client } = options
  const [since, setSince] = useState<number | null>(null)
  const live = useRef<{ recording: ArenaRecording; round: boolean } | null>(null)
  const tail = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const stop = useCallback(async () => {
    clearTimeout(tail.current)
    const current = live.current
    if (current === null) return
    live.current = null
    setSince(null)
    const blob = await current.recording.stop()
    const { fileName, onFail } = latest.current
    if (blob === null) onFail('the video came out empty: nothing was recorded.')
    else downloadBlob(blob, fileName(current.recording.format.extension))
  }, [])

  const start = useCallback((round: boolean): boolean => {
    if (live.current !== null) return true
    const { canvas, text, onFail } = latest.current
    const handle = canvas.current
    const recording = handle === null ? null : recordArena(handle, text)
    if (recording === null) {
      onFail('this browser cannot record the arena.')
      return false
    }
    live.current = { recording, round }
    setSince(performance.now())
    return true
  }, [])

  const toggle = useCallback(() => {
    if (live.current === null) start(false)
    else void stop()
  }, [start, stop])

  const exportRound = useCallback(() => {
    if (live.current !== null) return
    const { client } = latest.current
    const { status } = client.store.getState()
    if (status !== 'paused' && status !== 'playing' && status !== 'ended') return
    client.pause()
    client.seek(0)
    void atStart(client.store).then(() => {
      if (start(true)) client.play()
    })
  }, [start])

  // The end, as the battle reaches it: of the round for an export, of the match for any.
  useEffect(
    () =>
      client.store.subscribe((state, last) => {
        const current = live.current
        if (current === null || state.status !== 'ended' || last.status === 'ended') return
        const over = state.match !== null && state.match.rounds.length >= state.match.of
        if (!current.round && !over) return
        clearTimeout(tail.current)
        tail.current = setTimeout(() => void stop(), TAIL_MS)
      }),
    [client, stop],
  )

  useEffect(() => () => void stop(), [stop])

  return { since, toggle, exportRound }
}

/** Resolves once the battle stands paused at cycle 0: the seek back has drawn. */
function atStart(store: ArenaVideoOptions['client']['store']): Promise<void> {
  const ready = () => {
    const { status, cycle } = store.getState()
    return status === 'paused' && cycle === 0
  }
  if (ready()) return Promise.resolve()
  return new Promise((resolve) => {
    const off = store.subscribe(() => {
      if (!ready()) return
      off()
      resolve()
    })
  })
}

/** How long a recording has run: `0:07`, `1:32`. */
export function recordingLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
