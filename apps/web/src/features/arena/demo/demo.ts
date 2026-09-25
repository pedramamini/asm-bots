/**
 * The home page's demo battle (PRODUCT_SPEC §1): four roster bots in the arena at 400 cycles a
 * frame, a new random seed each battle, over and over. `DemoLoop` drives an `ArenaClient`
 * through it. Under reduced motion the demo is a still instead: `stillFrame` gets one battle's
 * core at one cycle, and `paintStill` draws its owner map. The demo makes no sound.
 */
import { rosterImage } from '@asmbots/bots'
import { DEFAULT_CONFIG, Pcg32, PlacementError, place } from '@asmbots/engine'
import type { Theme } from '@asmbots/ui/themes'
import { CorePainter } from '../render/canvas2d'
import { ArenaScene, SIDE } from '../render/scene'
import { randomSeed } from '../setup/config'
import type { ArenaClient } from '../worker/client'
import type { ArenaBot, FrameMessage, Speed } from '../worker/protocol'

/**
 * The demo's bots, in hue order: two painters that fill the core with color, a bomber, and a
 * replicator. Paper outlasts the rest in most seeds.
 */
export const DEMO_SLUGS = ['painter-lcg', 'painter-spiral', 'dwarf', 'paper'] as const

/**
 * Cycles per frame. The duel config ends most of these battles at 30,000 to 80,000 cycles: 2 to
 * 4 s at 60 fps.
 */
export const DEMO_SPEED: Speed = 400

/** How long the demo holds a battle's end before the next battle, ms. */
export const DEMO_HOLD_MS = 3000

/**
 * The still under reduced motion: all four bots alive, and each one's mark plain (the LCG's
 * clouds, the spiral, the dwarf's stripes, paper's streaks).
 */
export const STILL_SEED = 62
export const STILL_CYCLE = 24_000

/** Random seeds the demo draws before it falls back to `STILL_SEED`, which places the bots. */
const SEED_TRIES = 32

/** The demo's bots as the Worker loads them. */
export function demoBots(): ArenaBot[] {
  return DEMO_SLUGS.map((slug) => {
    const { name, author, strategy, version, bytes } = rosterImage(slug)
    return { name, bytes, meta: { author, strategy, version } }
  })
}

/** Whether images of `sizes` place with `seed` at the engine's spacing (ISA §5.5). */
function places(sizes: readonly number[], seed: number): boolean {
  try {
    place(sizes, DEFAULT_CONFIG.minSpacing, new Pcg32(seed))
    return true
  } catch (error) {
    if (error instanceof PlacementError) return false
    throw error
  }
}

/** A random seed that places `bots`. */
export function demoSeed(bots: readonly ArenaBot[], random: () => number = randomSeed): number {
  const sizes = bots.map((bot) => bot.bytes.length)
  for (let i = 0; i < SEED_TRIES; i++) {
    const seed = random()
    if (places(sizes, seed)) return seed
  }
  return STILL_SEED
}

export interface DemoLoopOptions {
  readonly bots: readonly ArenaBot[]
  /** Draws the seeds. Default: `randomSeed`. */
  readonly random?: (() => number) | undefined
  /** How long a battle's end holds, ms. Default: `DEMO_HOLD_MS`. */
  readonly holdMs?: number | undefined
  /** Cycles per frame. Default: `DEMO_SPEED`. */
  readonly speed?: Speed | undefined
  /** Hears each battle's seed as it loads. */
  readonly onBattle?: ((seed: number) => void) | undefined
}

/**
 * The demo's loop on `client`: a battle with a new seed, played to its end, held there a moment,
 * then the next. It plays only while someone can see it (`setVisible`): out of sight, the battle
 * pauses, and a next battle waits until the demo shows again.
 */
export class DemoLoop {
  private readonly client: ArenaClient
  private readonly options: DemoLoopOptions
  private visible = true
  private hold: ReturnType<typeof setTimeout> | null = null
  /** The hold ran out while nobody could see: the next battle starts when the demo shows. */
  private due = false
  private readonly off: () => void

  constructor(client: ArenaClient, options: DemoLoopOptions) {
    this.client = client
    this.options = options
    this.off = client.on('ended', () => this.ended())
  }

  /** Sets the speed and starts the first battle. */
  start(): void {
    this.client.speed(this.options.speed ?? DEMO_SPEED)
    this.next()
  }

  /** Whether anyone can see the demo: the tab is visible and the demo on screen. */
  setVisible(visible: boolean): void {
    if (visible === this.visible) return
    this.visible = visible
    if (!visible) {
      this.client.pause()
      return
    }
    if (this.due) {
      this.due = false
      this.next()
    } else if (this.hold === null) {
      this.client.play()
    }
  }

  /** Stops the loop. The client stays the caller's. */
  dispose(): void {
    this.off()
    if (this.hold !== null) clearTimeout(this.hold)
    this.hold = null
  }

  private next(): void {
    const seed = demoSeed(this.options.bots, this.options.random)
    this.options.onBattle?.(seed)
    this.client.load(this.options.bots, { seed })
    if (this.visible) this.client.play()
  }

  private ended(): void {
    if (this.hold !== null) clearTimeout(this.hold)
    this.hold = setTimeout(() => {
      this.hold = null
      if (this.visible) this.next()
      else this.due = true
    }, this.options.holdMs ?? DEMO_HOLD_MS)
  }
}

/** The next frame `client` gets, or its next error as a rejection. */
function nextFrame(client: ArenaClient): Promise<FrameMessage> {
  return new Promise((resolve, reject) => {
    const offs = [
      client.on('frame', (frame) => {
        for (const off of offs) off()
        resolve(frame)
      }),
      client.on('error', ({ message }) => {
        for (const off of offs) off()
        reject(new Error(message))
      }),
    ]
  })
}

/** The still's frame: battle `STILL_SEED` at `STILL_CYCLE`, the whole core. */
export async function stillFrame(
  client: ArenaClient,
  bots: readonly ArenaBot[],
): Promise<FrameMessage> {
  const loaded = nextFrame(client)
  client.load(bots, { seed: STILL_SEED })
  await loaded
  const seeked = nextFrame(client)
  client.seek(STILL_CYCLE)
  return seeked
}

/**
 * Paints the core of `frame`, a full frame, onto `canvas`, a pixel a byte (`SIDE` x `SIDE`),
 * as the 2D renderer paints it: each bot's territory in its hue over the arena's black.
 */
export function paintStill(canvas: HTMLCanvasElement, frame: FrameMessage, theme: Theme): void {
  const context = canvas.getContext('2d')
  if (context === null) return
  const scene = new ArenaScene()
  scene.apply(frame)
  scene.advance(0)
  const painter = new CorePainter(undefined, theme)
  painter.paint(scene)
  const image = context.createImageData(SIDE, SIDE)
  image.data.set(painter.pixels)
  context.putImageData(image, 0, 0)
}
