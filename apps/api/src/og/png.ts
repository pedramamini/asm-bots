/**
 * A share card's SVG as a PNG, at the edge: resvg compiled to WebAssembly, with JetBrains Mono
 * (the kit's Latin subset as TrueType, OFL) as its only font, since a Worker has no system fonts.
 * A glyph outside the subset draws as nothing. The module starts on the first card an isolate
 * draws, so no other request pays for it.
 */
import { initWasm, Resvg } from '@resvg/resvg-wasm'
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm'
import regular from './fonts/jetbrains-mono-latin-400.ttf'
import bold from './fonts/jetbrains-mono-latin-700.ttf'

/** The family every card names first. */
export const CARD_FONT_FAMILY = 'JetBrains Mono'

let ready: Promise<void> | null = null

/** Starts resvg once an isolate; a failed start is tried again on the next card. */
function start(): Promise<void> {
  ready ??= initWasm(resvgWasm).catch((error: unknown) => {
    ready = null
    throw error
  })
  return ready
}

/** `svg` drawn at its own size as a PNG. */
export async function svgToPng(svg: string): Promise<Uint8Array<ArrayBuffer>> {
  await start()
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'original' },
    font: {
      fontBuffers: [new Uint8Array(regular), new Uint8Array(bold)],
      defaultFontFamily: CARD_FONT_FAMILY,
      monospaceFamily: CARD_FONT_FAMILY,
    },
  })
  try {
    const image = resvg.render()
    try {
      // Its own buffer: the bytes outlive the image's WebAssembly memory.
      return new Uint8Array(image.asPng())
    } finally {
      image.free()
    }
  } finally {
    resvg.free()
  }
}
