import { cx } from '@asmbots/ui'

/** A 5 × 7 face for the letters the bands spell, a row a string, `#` lit. */
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
}

/** The imp's bytes, `movsw` then `nop`: what the lit cells hold, as if it had copied itself there. */
const IMP = ['A5', '90'] as const

const ROWS = 11
const PAD_ROWS = 2
const BYTE_WIDTH = 18
const ROW_HEIGHT = 13
const ADDRESS_WIDTH = 50

/** Which cells of a `cols`-wide band `word` lights, row by row: the word centered, a cell a pixel. */
export function litCells(word: string, cols: number): boolean[][] {
  const glyphs = [...word.toUpperCase()].map((letter) => GLYPHS[letter] ?? GLYPHS[' '] ?? [])
  const wordCols = glyphs.length * 6 - 1
  const left = Math.max(0, Math.floor((cols - wordCols) / 2))
  return Array.from({ length: ROWS }, (_, row) =>
    Array.from({ length: cols }, (_, col) => {
      const glyphRow = row - PAD_ROWS
      const at = col - left
      if (glyphRow < 0 || glyphRow >= 7 || at < 0 || at % 6 === 5) return false
      return glyphs[Math.floor(at / 6)]?.[glyphRow]?.[at % 6] === '#'
    }),
  )
}

/** Pedram's GitHub bio, https://github.com/pedramamini: what the unlit cells spell for anyone who decodes them. */
const BIO = 'Repeat cyber security founder, investor, and advisor. Vibing on @RunMaestro.'

/** The bio as bytes, `00` in place of each space and at the end, so the words read as C strings. */
const BIO_BYTES = [...BIO.replaceAll(' ', '\0'), '\0'].map((char) =>
  char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'),
)

/** Each cell's byte and whether it is lit: the imp's bytes in the letters, the bio in reading order around them. */
export function bandBytes(word: string, cols: number): { byte: string; on: boolean }[][] {
  let imp = 0
  let bio = 0
  return litCells(word, cols).map((row) =>
    row.map((on) => ({
      byte: (on ? IMP[imp++ % IMP.length] : BIO_BYTES[bio++ % BIO_BYTES.length]) ?? '00',
      on,
    })),
  )
}

export interface HexBandProps {
  /** What the lit bytes spell: letters of `ASM BOTS`. */
  word: string
  /** Bytes a row. Default 64. */
  cols?: number | undefined
  /** The first row's address. Default 0x0400. */
  base?: number | undefined
  className?: string | undefined
}

/**
 * A core dump whose lit bytes spell a word (DESIGN_SYSTEM §10): the imp's `A5 90` copied into
 * the shape of the letters, the dim bytes around them a bio in ASCII. SVG text in the tokens, so it follows
 * the theme with no script; drawing, not content, so hidden from assistive tech.
 */
export function HexBand({ word, cols = 64, base = 0x0400, className }: HexBandProps) {
  const cells = bandBytes(word, cols)
  return (
    <svg
      viewBox={`0 0 ${ADDRESS_WIDTH + cols * BYTE_WIDTH} ${ROWS * ROW_HEIGHT + 4}`}
      aria-hidden
      className={cx('block h-auto w-full font-mono', className)}
      fontSize={10}
    >
      {cells.map((row, r) => (
        <text key={r} y={(r + 1) * ROW_HEIGHT} className="fill-dim">
          <tspan x={0}>{(base + r * cols).toString(16).toUpperCase().padStart(4, '0')}</tspan>
          {row.map(({ byte, on }, c) => (
            <tspan
              key={c}
              x={ADDRESS_WIDTH + c * BYTE_WIDTH}
              className={on ? 'fill-accent-fg' : undefined}
              fillOpacity={on ? 1 : 0.55}
            >
              {byte}
            </tspan>
          ))}
        </text>
      ))}
    </svg>
  )
}
