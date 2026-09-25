/**
 * The boot screen's backdrop: a core dump that boots. The core starts as noise (memory no one has
 * written), a sweep zeroes it row by row, four bots load at random addresses, and they run: an imp
 * copies itself forward, a dwarf drops zero bombs every 4th byte going back, a stone throws `CC`
 * bytes in long strides, and a paper copies itself to new places. After `REBOOT_MS` the sweep
 * comes again and it all starts over. It is a picture of the game, not the engine: the moves are
 * drawn, not run. `CoreDump` is the model (seeded, so tests can hold it); `DumpPainter` draws it
 * on a canvas, only the cells that changed.
 */

/** How long the zeroing sweep takes, ms. */
export const ZERO_MS = 900
/** When the bots load, ms after the boot starts. */
export const LOAD_MS = 1000
/** When they start to run, ms. */
export const RUN_MS = 1300
/** A tick of the bots, ms: each bot makes one move. */
export const TICK_MS = 45
/** How long after the boot the core reboots, ms. */
export const REBOOT_MS = 16_000
/** How long a write glows, ms. */
const HEAT_MS = 700
/** The most time one `advance` takes in: a tab that comes back does not replay what it missed. */
const MAX_STEP_MS = 100

/** Owner of a cell no one has written since power-on: noise. */
export const NOISE = -2
/** Owner of a zeroed cell no bot has written. */
export const EMPTY = -1

export type DumpBotKind = 'imp' | 'dwarf' | 'stone' | 'paper'

/** The bots that load, in order, with their bytes (each shaped like its kind, not assembled). */
export const DUMP_BOTS: readonly { kind: DumpBotKind; code: readonly number[] }[] = [
  { kind: 'imp', code: [0xe8, 0x00, 0x00, 0x5b, 0x83, 0xeb, 0x03, 0xa5, 0x90] },
  { kind: 'dwarf', code: [0x83, 0xeb, 0x04, 0xc7, 0x07, 0x00, 0x00, 0xeb, 0xf7] },
  { kind: 'stone', code: [0x81, 0xc3, 0x25, 0x00, 0xc6, 0x07, 0xcc, 0xeb, 0xf6] },
  { kind: 'paper', code: [0xe8, 0x00, 0x00, 0x5e, 0xb9, 0x0a, 0x00, 0xf3, 0xa4, 0xeb] },
]

export interface DumpBot {
  readonly kind: DumpBotKind
  /** Its hue: a bot index into the theme's bot palette. */
  readonly hue: number
  /** The cell it runs: the IP the painter outlines. */
  ip: number
  /** Where it writes next (the dwarf's and the stone's bombs). */
  ptr: number
  /** Where its code starts. */
  base: number
  /** Ticks it has run. */
  ticks: number
}

/** A small seeded generator (mulberry32): the same seed draws the same boot. */
export function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class CoreDump {
  readonly cols: number
  readonly rows: number
  readonly size: number
  readonly bytes: Uint8Array
  /** The bot index (into `bots`) that wrote each cell last, or `EMPTY` or `NOISE`. */
  readonly owner: Int8Array
  /** How bright each cell's last write still glows, 0..1. */
  readonly heat: Float32Array
  bots: DumpBot[] = []
  /** ms since the boot (or the last reboot) started. */
  time = 0
  /** Rows the sweep has zeroed. */
  zeroed = 0
  private loaded = false
  private tickMs = 0
  private readonly hot = new Set<number>()
  private readonly dirtyFlag: Uint8Array
  private dirtyList: number[] = []
  private readonly rand: () => number

  constructor(cols: number, rows: number, seed = Date.now()) {
    this.cols = Math.max(1, cols)
    this.rows = Math.max(1, rows)
    this.size = this.cols * this.rows
    this.bytes = new Uint8Array(this.size)
    this.owner = new Int8Array(this.size).fill(NOISE)
    this.heat = new Float32Array(this.size)
    this.dirtyFlag = new Uint8Array(this.size)
    this.rand = random(seed)
    for (let i = 0; i < this.size; i++) this.bytes[i] = Math.floor(this.rand() * 256)
  }

  /** Whether the bots are loaded and running. */
  get running(): boolean {
    return this.time >= RUN_MS
  }

  /** Moves the boot on by `ms`. */
  advance(ms: number): void {
    const dt = Math.min(Math.max(ms, 0), MAX_STEP_MS)
    this.time += dt
    this.cool(dt)
    const target = Math.min(this.rows, Math.floor((this.rows * this.time) / ZERO_MS))
    while (this.zeroed < target) this.zeroRow(this.zeroed++)
    if (!this.loaded && this.time >= LOAD_MS) this.load()
    if (this.time >= RUN_MS) {
      this.tickMs += dt
      while (this.tickMs >= TICK_MS) {
        this.tickMs -= TICK_MS
        this.tick()
      }
    }
    if (this.time >= REBOOT_MS) this.reboot()
  }

  /** Runs the boot to `ms` and puts every glow out: the still that reduced motion shows. */
  settle(ms = RUN_MS + 60 * TICK_MS): void {
    while (this.time < ms) this.advance(Math.min(MAX_STEP_MS, ms - this.time))
    for (const i of this.hot) {
      this.heat[i] = 0
      this.dirty(i)
    }
    this.hot.clear()
  }

  /** The cells that changed since the last call, each once. */
  takeDirty(): number[] {
    const list = this.dirtyList
    for (const i of list) this.dirtyFlag[i] = 0
    this.dirtyList = []
    return list
  }

  /** The cells the bots run now. */
  ips(): number[] {
    return this.bots.map((bot) => bot.ip)
  }

  private wrap(i: number): number {
    return ((i % this.size) + this.size) % this.size
  }

  private dirty(i: number): void {
    if (this.dirtyFlag[i] === 1) return
    this.dirtyFlag[i] = 1
    this.dirtyList.push(i)
  }

  private write(i: number, byte: number, owner: number, heat = 1): void {
    const at = this.wrap(i)
    this.bytes[at] = byte
    this.owner[at] = owner
    this.heat[at] = heat
    this.hot.add(at)
    this.dirty(at)
  }

  private cool(dt: number): void {
    for (const i of this.hot) {
      const next = (this.heat[i] ?? 0) - dt / HEAT_MS
      this.heat[i] = Math.max(0, next)
      if (next <= 0) this.hot.delete(i)
      this.dirty(i)
    }
  }

  private zeroRow(row: number): void {
    for (let c = 0; c < this.cols; c++) this.write(row * this.cols + c, 0, EMPTY, 0.55)
  }

  private load(): void {
    this.loaded = true
    const hues = [0, 3, 6, 9].sort(() => this.rand() - 0.5)
    const slot = Math.floor(this.size / DUMP_BOTS.length)
    this.bots = DUMP_BOTS.map(({ kind, code }, index) => {
      const base = this.wrap(
        index * slot + Math.floor(this.rand() * Math.max(1, slot - code.length)),
      )
      for (const [k, byte] of code.entries()) this.write(base + k, byte, index)
      const ip = kind === 'imp' ? this.wrap(base + code.length - 2) : base
      return { kind, hue: hues[index] ?? index, ip, ptr: base, base, ticks: 0 }
    })
  }

  private tick(): void {
    this.bots.forEach((bot, index) => {
      const code = DUMP_BOTS[index]?.code ?? []
      const was = bot.ip
      bot.ticks++
      switch (bot.kind) {
        case 'imp':
          // movsw: the word it runs, one word on; then it runs the copy.
          this.write(bot.ip + 2, 0xa5, index)
          this.write(bot.ip + 3, 0x90, index)
          bot.ip = this.wrap(bot.ip + 2)
          break
        case 'dwarf':
          bot.ptr = this.wrap(bot.ptr - 4)
          this.write(bot.ptr, 0x00, index)
          bot.ip = this.wrap(bot.base + ((bot.ticks * 3) % code.length))
          break
        case 'stone':
          bot.ptr = this.wrap(bot.ptr + 37)
          this.write(bot.ptr, 0xcc, index)
          bot.ip = this.wrap(bot.base + ((bot.ticks * 2) % code.length))
          break
        case 'paper':
          if (bot.ticks % 24 === 0) {
            // A copy of itself somewhere new, and a process there.
            const to = this.wrap(Math.floor(this.rand() * this.size))
            for (const [k, byte] of code.entries()) this.write(to + k, byte, index)
            bot.base = to
          }
          bot.ip = this.wrap(bot.base + (bot.ticks % code.length))
          break
      }
      if (was !== bot.ip) this.dirty(was)
      this.dirty(bot.ip)
    })
  }

  private reboot(): void {
    for (const bot of this.bots) this.dirty(bot.ip)
    this.bots = []
    this.time = 0
    this.zeroed = 0
    this.loaded = false
    this.tickMs = 0
  }
}

/** The colors the painter draws with: CSS colors, read from the theme's tokens. */
export interface DumpPalette {
  background: string
  /** An address, and a zero byte no bot owns. */
  ruler: string
  /** A write's glow, and the sweep's. */
  write: string
  /** The outline of a cell a bot runs. */
  ip: string
  /** The theme's bot hues, by bot index. */
  bots: readonly string[]
}

/** The type the dump is set in, px. */
const FONT_PX = 12
/** A row's height, px. */
const ROW_PX = 16

const hex = (n: number, width: number) => n.toString(16).toUpperCase().padStart(width, '0')

/** Draws a `CoreDump` on a canvas: the addresses once, then each changed cell. */
export class DumpPainter {
  private readonly ctx: CanvasRenderingContext2D
  private charPx = 7.2
  private cellPx = 21.6
  private addressPx = 43
  private ips: number[] = []

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly palette: DumpPalette,
    private readonly family: string,
  ) {
    const ctx = canvas.getContext('2d')
    if (ctx === null) throw new Error('no 2d context')
    this.ctx = ctx
  }

  /** Sizes the canvas to `width` × `height` CSS px; returns the grid that fills it. */
  layout(width: number, height: number, dpr: number): { cols: number; rows: number } {
    const scale = Math.min(Math.max(dpr, 1), 2)
    this.canvas.width = Math.round(width * scale)
    this.canvas.height = Math.round(height * scale)
    this.ctx.setTransform(scale, 0, 0, scale, 0, 0)
    this.ctx.font = `${FONT_PX}px ${this.family}`
    this.ctx.textBaseline = 'middle'
    this.charPx = this.ctx.measureText('0').width || 7.2
    this.cellPx = this.charPx * 3
    this.addressPx = this.charPx * 6
    const cols = Math.max(8, Math.floor((width - this.addressPx - 8) / this.cellPx))
    const rows = Math.max(1, Math.ceil(height / ROW_PX))
    return { cols, rows }
  }

  /** The whole dump: the background, the addresses, every cell. */
  paintAll(dump: CoreDump): void {
    const { ctx, palette } = this
    ctx.fillStyle = palette.background
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.fillStyle = palette.ruler
    ctx.globalAlpha = 0.8
    for (let row = 0; row < dump.rows; row++) {
      ctx.fillText(hex(row * dump.cols, 4), 4, row * ROW_PX + ROW_PX / 2)
    }
    ctx.globalAlpha = 1
    dump.takeDirty()
    for (let i = 0; i < dump.size; i++) this.cell(dump, i)
    this.ips = []
    this.outlineIps(dump)
  }

  /** The cells that changed since the last paint, and the IPs. */
  paint(dump: CoreDump): void {
    for (const i of this.ips) this.cell(dump, i)
    for (const i of dump.takeDirty()) this.cell(dump, i)
    this.outlineIps(dump)
  }

  private at(dump: CoreDump, i: number): { x: number; y: number } {
    const row = Math.floor(i / dump.cols)
    const col = i % dump.cols
    return { x: this.addressPx + 4 + col * this.cellPx, y: row * ROW_PX }
  }

  private cell(dump: CoreDump, i: number): void {
    const { ctx, palette } = this
    const { x, y } = this.at(dump, i)
    ctx.fillStyle = palette.background
    ctx.fillRect(x - 2, y, this.cellPx, ROW_PX)
    const owner = dump.owner[i] ?? NOISE
    const byte = dump.bytes[i] ?? 0
    const heat = dump.heat[i] ?? 0
    const text = hex(byte, 2)
    const mid = y + ROW_PX / 2
    const bot = owner >= 0 ? dump.bots[owner] : undefined
    const hue = bot === undefined ? undefined : palette.bots[bot.hue % palette.bots.length]
    if (hue !== undefined) {
      if (heat > 0) {
        ctx.globalAlpha = heat * 0.35
        ctx.fillStyle = hue
        ctx.fillRect(x - 2, y + 1, this.cellPx - 2, ROW_PX - 2)
      }
      ctx.globalAlpha = byte === 0 ? 0.5 : 1
      ctx.fillStyle = hue
    } else {
      ctx.globalAlpha = owner === NOISE ? 0.3 : 0.55
      ctx.fillStyle = palette.ruler
    }
    ctx.fillText(text, x, mid)
    if (heat > 0) {
      ctx.globalAlpha = heat
      ctx.fillStyle = palette.write
      ctx.fillText(text, x, mid)
    }
    ctx.globalAlpha = 1
  }

  private outlineIps(dump: CoreDump): void {
    const { ctx, palette } = this
    this.ips = dump.ips()
    ctx.strokeStyle = palette.ip
    ctx.lineWidth = 1
    for (const i of this.ips) {
      const { x, y } = this.at(dump, i)
      ctx.strokeRect(x - 1.5, y + 1.5, this.charPx * 2 + 3, ROW_PX - 3)
    }
  }
}
