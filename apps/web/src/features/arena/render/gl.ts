/**
 * The arena's WebGL2 renderer (DESIGN_SYSTEM §5, ARCHITECTURE §6). Each image:
 *
 * 1. Uploads what changed in the scene, each texture whole: the owner map and the non-zero
 *    bitmask (R8UI, a bit per byte), and the write and exec ages (R16UI, ms), 256 x 256.
 * 2. The scene pass: `ARENA_FRAG` over the view (territory, trails, flashes, lattice), then the
 *    ripples and pulses, then an IP marker per process, both instanced. It writes the color and,
 *    to a second target, the emissive light alone.
 * 3. Bloom: the emissive light at quarter size, blurred across and then down.
 * 4. Composite onto the canvas: the color plus the bloom, times the scanlines and the vignette.
 * 5. Zoomed in, the minimap: the owner map again, small, with the view's outline.
 *
 * With every post effect off, the scene pass draws straight onto the canvas.
 */
import { getPaletteFloat32, PALETTE_INDEX, type Theme } from '@asmbots/ui/themes'
import type { ArenaEffects } from '../../../store/settings'
import type { Camera, Rect } from './camera'
import { hasPost, type Post, postOf } from './post'
import { type ArenaScene, EFFECT_CAPACITY, EFFECT_FIELDS, SIDE } from './scene'
import {
  ARENA_FRAG,
  BLUR_FRAG,
  COMPOSITE_FRAG,
  DOWNSAMPLE_FRAG,
  MARKER_FRAG,
  MARKER_VERT,
  QUAD_VERT,
  RING_FRAG,
  RING_VERT,
} from './shaders'
import type { ArenaRenderer } from './types'

/** The arena is opaque black in every theme, so the canvas needs no alpha. */
const ATTRIBUTES: WebGLContextAttributes = {
  alpha: false,
  premultipliedAlpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
  powerPreference: 'high-performance',
}

/** Texture units. The data textures stay bound to theirs; the post passes share the last two. */
const OWNER_UNIT = 0
const NONZERO_UNIT = 1
const WRITE_UNIT = 2
const EXEC_UNIT = 3
const SOURCE_UNIT = 4
const BLOOM_UNIT = 5

const CLEAR = new Float32Array([0, 0, 0, 0])

interface Program {
  readonly program: WebGLProgram
  /** Uniform locations by name; an array's under its bare name. */
  readonly u: Readonly<Record<string, WebGLUniformLocation>>
}

/** The render targets of the post effects, sized to the canvas. */
interface Targets {
  readonly width: number
  readonly height: number
  readonly scene: WebGLFramebuffer
  readonly color: WebGLTexture
  readonly glow: WebGLTexture
  readonly bloomWidth: number
  readonly bloomHeight: number
  /** Quarter size: the blur goes from the first to the second and back. */
  readonly bloom: readonly [WebGLFramebuffer, WebGLFramebuffer]
  readonly bloomTextures: readonly [WebGLTexture, WebGLTexture]
}

/** Everything on the GPU. A lost context loses it all; a restored one builds it again. */
interface Resources {
  readonly arena: Program
  readonly markers: Program
  readonly rings: Program
  readonly downsample: Program
  readonly blur: Program
  readonly composite: Program
  readonly owner: WebGLTexture
  readonly nonZero: WebGLTexture
  readonly writeAge: WebGLTexture
  readonly execAge: WebGLTexture
  /** No attributes: the full-screen triangle. */
  readonly empty: WebGLVertexArrayObject
  readonly markerVao: WebGLVertexArrayObject
  readonly ipBuffer: WebGLBuffer
  readonly ringVao: WebGLVertexArrayObject
  readonly effectBuffer: WebGLBuffer
  targets: Targets | null
}

/** The scene versions last uploaded; -1 uploads again. */
interface Uploaded {
  core: number
  age: number
  ips: number
  effects: number
  fade: number
  palette: number
}

function stale(): Uploaded {
  return { core: -1, age: -1, ips: -1, effects: -1, fade: -1, palette: -1 }
}

export interface GlRendererOptions {
  readonly scene: ArenaScene
  readonly camera: Camera
  readonly theme: Theme
  readonly effects: ArenaEffects
}

/**
 * The WebGL2 renderer on `canvas`, or null where the browser has no WebGL2. Throws when a shader
 * fails to build; the canvas then holds a WebGL2 context, so the 2D fallback needs a new canvas.
 */
export function createGlRenderer(
  canvas: HTMLCanvasElement,
  options: GlRendererOptions,
): GlRenderer | null {
  const gl = canvas.getContext('webgl2', ATTRIBUTES)
  if (gl === null) return null
  return new GlRenderer(canvas, gl, options)
}

export class GlRenderer implements ArenaRenderer {
  readonly kind = 'webgl2'
  private readonly canvas: HTMLCanvasElement
  private readonly gl: WebGL2RenderingContext
  private readonly scene: ArenaScene
  private readonly camera: Camera
  private res: Resources | null
  private uploaded = stale()
  private theme: Theme
  private effects: ArenaEffects
  private post: Post
  private palette: Float32Array
  private paletteVersion = 0
  private minimapOn = true
  private ratio = 1
  private dirty = true
  private drawnCamera = -1
  private disposed = false

  constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, options: GlRendererOptions) {
    this.canvas = canvas
    this.gl = gl
    this.scene = options.scene
    this.camera = options.camera
    this.theme = options.theme
    this.effects = options.effects
    this.post = postOf(options.theme, options.effects)
    this.palette = getPaletteFloat32(options.theme)
    this.res = build(gl)
    canvas.addEventListener('webglcontextlost', this.onLost)
    canvas.addEventListener('webglcontextrestored', this.onRestored)
  }

  resize(width: number, height: number, ratio: number): void {
    const w = Math.max(1, Math.round(width * ratio))
    const h = Math.max(1, Math.round(height * ratio))
    if (this.canvas.width !== w) this.canvas.width = w
    if (this.canvas.height !== h) this.canvas.height = h
    this.ratio = ratio
    this.dirty = true
  }

  setTheme(theme: Theme): void {
    if (theme === this.theme) return
    this.theme = theme
    this.palette = getPaletteFloat32(theme)
    this.paletteVersion++
    this.post = postOf(theme, this.effects)
    this.dirty = true
  }

  setEffects(effects: ArenaEffects): void {
    this.effects = effects
    this.post = postOf(this.theme, effects)
    this.dirty = true
  }

  setMinimap(on: boolean): void {
    if (on === this.minimapOn) return
    this.minimapOn = on
    this.dirty = true
  }

  invalidate(): void {
    this.dirty = true
  }

  render(now: number, force = false): boolean {
    if (this.disposed) return false
    const moved = this.scene.advance(now)
    const viewMoved = this.camera.version !== this.drawnCamera
    if (!force && !moved && !viewMoved && !this.dirty) return false
    const res = this.res
    if (res === null || this.gl.isContextLost()) return false
    this.dirty = false
    this.drawnCamera = this.camera.version
    this.upload(res)
    this.draw(res, now)
    return true
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.canvas.removeEventListener('webglcontextlost', this.onLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored)
    // Not `loseContext()`: a canvas keeps its context, and a renderer made again on the same
    // canvas (React's development double mount) would get the lost one.
    if (this.res !== null && !this.gl.isContextLost()) release(this.gl, this.res)
    this.res = null
  }

  private readonly onLost = (event: Event): void => {
    // Asks for the context back.
    event.preventDefault()
    this.res = null
  }

  private readonly onRestored = (): void => {
    if (this.disposed) return
    this.res = build(this.gl)
    this.uploaded = stale()
    this.dirty = true
  }

  private upload(res: Resources): void {
    const { gl, scene, uploaded } = this
    if (scene.coreVersion !== uploaded.core) {
      uploaded.core = scene.coreVersion
      texUpload(gl, OWNER_UNIT, res.owner, SIDE, SIDE, gl.UNSIGNED_BYTE, scene.owner)
      texUpload(gl, NONZERO_UNIT, res.nonZero, SIDE >> 3, SIDE, gl.UNSIGNED_BYTE, scene.nonZero)
    }
    if (scene.ageVersion !== uploaded.age) {
      uploaded.age = scene.ageVersion
      texUpload(gl, WRITE_UNIT, res.writeAge, SIDE, SIDE, gl.UNSIGNED_SHORT, scene.writeAge)
      texUpload(gl, EXEC_UNIT, res.execAge, SIDE, SIDE, gl.UNSIGNED_SHORT, scene.execAge)
    }
    if (scene.ipsVersion !== uploaded.ips) {
      uploaded.ips = scene.ipsVersion
      gl.bindBuffer(gl.ARRAY_BUFFER, res.ipBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, scene.ips, gl.DYNAMIC_DRAW)
    }
    if (scene.effectVersion !== uploaded.effects) {
      uploaded.effects = scene.effectVersion
      gl.bindBuffer(gl.ARRAY_BUFFER, res.effectBuffer)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scene.effects, 0, scene.effectCount * EFFECT_FIELDS)
    }
    if (scene.fadeVersion !== uploaded.fade) {
      uploaded.fade = scene.fadeVersion
      gl.useProgram(res.arena.program)
      gl.uniform4fv(uniform(res.arena, 'uFade'), scene.fade)
    }
    if (this.paletteVersion !== uploaded.palette) {
      uploaded.palette = this.paletteVersion
      for (const p of [res.arena, res.markers, res.rings]) {
        gl.useProgram(p.program)
        gl.uniform4fv(uniform(p, 'uPalette'), this.palette)
      }
    }
  }

  private draw(res: Resources, now: number): void {
    const { gl, camera, scene, ratio: r } = this
    const width = this.canvas.width
    const height = this.canvas.height
    const offscreen = hasPost(this.post)
    const bg = this.color(PALETTE_INDEX.bg)

    gl.disable(gl.BLEND)
    gl.disable(gl.SCISSOR_TEST)
    gl.viewport(0, 0, width, height)
    const targets = offscreen ? this.targets(res, width, height) : null
    if (targets !== null) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets.scene)
      gl.clearBufferfv(gl.COLOR, 0, bg)
      gl.clearBufferfv(gl.COLOR, 1, CLEAR)
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.clearColor(bg[0] as number, bg[1] as number, bg[2] as number, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }

    // The scene, inside the view: the ruler's margin stays black.
    const view = camera.view
    const left = Math.round(view.x * r)
    const top = Math.round(view.y * r)
    gl.enable(gl.SCISSOR_TEST)
    gl.scissor(left, 0, Math.max(0, width - left), Math.max(0, height - top))
    const originX = camera.originX * r
    const originY = camera.originY * r
    const cell = camera.cell * r
    this.drawArena(res, originX, originY, cell, camera.lattice ? r : 0, 1, height)

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    if (scene.effectCount > 0) {
      const p = res.rings
      gl.useProgram(p.program)
      gl.uniform2f(uniform(p, 'uOrigin'), originX, originY)
      gl.uniform1f(uniform(p, 'uCell'), cell)
      gl.uniform2f(uniform(p, 'uSize'), width, height)
      gl.uniform1f(uniform(p, 'uRatio'), r)
      gl.uniform1f(uniform(p, 'uNow'), scene.time(now))
      gl.bindVertexArray(res.ringVao)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, scene.effectCount)
    }
    const procs = scene.ips.length >> 1
    if (procs > 0) {
      const p = res.markers
      gl.useProgram(p.program)
      gl.uniform2f(uniform(p, 'uOrigin'), originX, originY)
      gl.uniform1f(uniform(p, 'uCell'), cell)
      gl.uniform2f(uniform(p, 'uSize'), width, height)
      gl.uniform1f(uniform(p, 'uRatio'), r)
      gl.bindVertexArray(res.markerVao)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, procs)
    }
    gl.disable(gl.BLEND)
    gl.disable(gl.SCISSOR_TEST)

    if (targets !== null) this.postPass(res, targets)
    const box = this.minimapOn ? camera.minimap() : null
    if (box !== null) this.drawMinimap(res, box)
    gl.bindVertexArray(null)
  }

  /** `ARENA_FRAG` over the scissored target: cell (0, 0) at (`x`, `y`), `cell` px a cell. */
  private drawArena(
    res: Resources,
    x: number,
    y: number,
    cell: number,
    lattice: number,
    glow: number,
    height: number,
  ): void {
    const { gl } = this
    const p = res.arena
    gl.useProgram(p.program)
    gl.uniform2f(uniform(p, 'uOrigin'), x, y)
    gl.uniform1f(uniform(p, 'uCell'), cell)
    gl.uniform1f(uniform(p, 'uHeight'), height)
    gl.uniform1f(uniform(p, 'uLattice'), lattice)
    gl.uniform1f(uniform(p, 'uGlow'), glow)
    gl.bindVertexArray(res.empty)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /** Bloom from the emissive target, then the composite onto the canvas. */
  private postPass(res: Resources, t: Targets): void {
    const { gl, post } = this
    gl.bindVertexArray(res.empty)
    if (post.bloom > 0) {
      gl.viewport(0, 0, t.bloomWidth, t.bloomHeight)
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.bloom[0])
      const down = res.downsample
      gl.useProgram(down.program)
      bindTexture(gl, SOURCE_UNIT, t.glow)
      gl.uniform2f(uniform(down, 'uTexel'), 1 / t.width, 1 / t.height)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      const blur = res.blur
      gl.useProgram(blur.program)
      gl.uniform2f(uniform(blur, 'uTexel'), 1 / t.bloomWidth, 1 / t.bloomHeight)
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.bloom[1])
      bindTexture(gl, SOURCE_UNIT, t.bloomTextures[0])
      gl.uniform2f(uniform(blur, 'uStep'), 1 / t.bloomWidth, 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.bloom[0])
      bindTexture(gl, SOURCE_UNIT, t.bloomTextures[1])
      gl.uniform2f(uniform(blur, 'uStep'), 0, 1 / t.bloomHeight)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, t.width, t.height)
    const p = res.composite
    gl.useProgram(p.program)
    bindTexture(gl, SOURCE_UNIT, t.color)
    bindTexture(gl, BLOOM_UNIT, post.bloom > 0 ? t.bloomTextures[0] : null)
    gl.uniform2f(uniform(p, 'uSize'), t.width, t.height)
    gl.uniform1f(uniform(p, 'uRatio'), this.ratio)
    gl.uniform1f(uniform(p, 'uBloomStrength'), post.bloom)
    gl.uniform1f(uniform(p, 'uScanlines'), post.scanlines)
    gl.uniform1f(uniform(p, 'uVignette'), post.vignette)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    // A texture bound to a unit while it is a target is a feedback loop: let both go.
    bindTexture(gl, SOURCE_UNIT, null)
    bindTexture(gl, BLOOM_UNIT, null)
  }

  /** The owner map in `box`, framed, with the view's outline on it. */
  private drawMinimap(res: Resources, box: Rect): void {
    const { gl, camera, ratio: r } = this
    const height = this.canvas.height
    const x = Math.round(box.x * r)
    const y = Math.round(box.y * r)
    const side = Math.round(box.width * r)
    const line = Math.max(1, Math.round(r))
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvas.width, height)
    gl.enable(gl.SCISSOR_TEST)
    const frame = this.color(PALETTE_INDEX.ruler)
    this.fill(x - line, y - line, side + 2 * line, side + 2 * line, frame)
    this.fill(x, y, side, side, this.color(PALETTE_INDEX.bg))
    gl.scissor(x, height - y - side, side, side)
    this.drawArena(res, x, y, side / SIDE, 0, 0, height)

    const v = camera.visible()
    const k = side / SIDE
    const vl = x + Math.round(v.left * k)
    const vt = y + Math.round(v.top * k)
    const vw = Math.max(line, x + Math.round(v.right * k) - vl)
    const vh = Math.max(line, y + Math.round(v.bottom * k) - vt)
    const ip = this.color(PALETTE_INDEX.ip)
    this.fill(vl, vt, vw, line, ip)
    this.fill(vl, vt + vh - line, vw, line, ip)
    this.fill(vl, vt, line, vh, ip)
    this.fill(vl + vw - line, vt, line, vh, ip)
    gl.disable(gl.SCISSOR_TEST)
  }

  /** Fills a box of the canvas, px from its top-left, with a scissored clear. */
  private fill(x: number, y: number, width: number, height: number, color: Float32Array): void {
    const { gl } = this
    gl.scissor(x, this.canvas.height - y - height, width, height)
    gl.clearColor(color[0] as number, color[1] as number, color[2] as number, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  /** A palette row: RGBA, 0..1. */
  private color(row: number): Float32Array {
    return this.palette.subarray(row * 4, row * 4 + 4)
  }

  /** The post targets for a `width` x `height` canvas, made again when its size changes. */
  private targets(res: Resources, width: number, height: number): Targets {
    const current = res.targets
    if (current !== null && current.width === width && current.height === height) return current
    const { gl } = this
    if (current !== null) releaseTargets(gl, current)
    const color = colorTexture(gl, width, height, gl.NEAREST)
    const glow = colorTexture(gl, width, height, gl.LINEAR)
    const scene = framebuffer(gl, [color, glow])
    const bloomWidth = Math.max(1, Math.ceil(width / 4))
    const bloomHeight = Math.max(1, Math.ceil(height / 4))
    const b0 = colorTexture(gl, bloomWidth, bloomHeight, gl.LINEAR)
    const b1 = colorTexture(gl, bloomWidth, bloomHeight, gl.LINEAR)
    res.targets = {
      width,
      height,
      scene,
      color,
      glow,
      bloomWidth,
      bloomHeight,
      bloom: [framebuffer(gl, [b0]), framebuffer(gl, [b1])],
      bloomTextures: [b0, b1],
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return res.targets
  }
}

/** Compiles and links every program and makes the textures and buffers. Throws on a bad shader. */
function build(gl: WebGL2RenderingContext): Resources {
  const arena = link(gl, QUAD_VERT, ARENA_FRAG)
  const markers = link(gl, MARKER_VERT, MARKER_FRAG)
  const rings = link(gl, RING_VERT, RING_FRAG)
  const downsample = link(gl, QUAD_VERT, DOWNSAMPLE_FRAG)
  const blur = link(gl, QUAD_VERT, BLUR_FRAG)
  const composite = link(gl, QUAD_VERT, COMPOSITE_FRAG)

  // Rows of 32 and 256 bytes: no row padding.
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  const owner = dataTexture(gl, OWNER_UNIT, gl.R8UI, SIDE, SIDE)
  const nonZero = dataTexture(gl, NONZERO_UNIT, gl.R8UI, SIDE >> 3, SIDE)
  const writeAge = dataTexture(gl, WRITE_UNIT, gl.R16UI, SIDE, SIDE)
  const execAge = dataTexture(gl, EXEC_UNIT, gl.R16UI, SIDE, SIDE)

  gl.useProgram(arena.program)
  gl.uniform1i(uniform(arena, 'uOwner'), OWNER_UNIT)
  gl.uniform1i(uniform(arena, 'uNonZero'), NONZERO_UNIT)
  gl.uniform1i(uniform(arena, 'uWriteAge'), WRITE_UNIT)
  gl.uniform1i(uniform(arena, 'uExecAge'), EXEC_UNIT)
  for (const p of [downsample, blur]) {
    gl.useProgram(p.program)
    gl.uniform1i(uniform(p, 'uSource'), SOURCE_UNIT)
  }
  gl.useProgram(composite.program)
  gl.uniform1i(uniform(composite, 'uScene'), SOURCE_UNIT)
  gl.uniform1i(uniform(composite, 'uBloom'), BLOOM_UNIT)

  const empty = must(gl.createVertexArray(), 'a vertex array')
  const ipBuffer = must(gl.createBuffer(), 'a buffer')
  const markerVao = must(gl.createVertexArray(), 'a vertex array')
  gl.bindVertexArray(markerVao)
  gl.bindBuffer(gl.ARRAY_BUFFER, ipBuffer)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribIPointer(0, 2, gl.UNSIGNED_SHORT, 4, 0)
  gl.vertexAttribDivisor(0, 1)
  const effectBuffer = must(gl.createBuffer(), 'a buffer')
  const ringVao = must(gl.createVertexArray(), 'a vertex array')
  gl.bindVertexArray(ringVao)
  gl.bindBuffer(gl.ARRAY_BUFFER, effectBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, EFFECT_CAPACITY * EFFECT_FIELDS * 4, gl.DYNAMIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, EFFECT_FIELDS * 4, 0)
  gl.vertexAttribDivisor(0, 1)
  gl.bindVertexArray(null)

  return {
    arena,
    markers,
    rings,
    downsample,
    blur,
    composite,
    owner,
    nonZero,
    writeAge,
    execAge,
    empty,
    markerVao,
    ipBuffer,
    ringVao,
    effectBuffer,
    targets: null,
  }
}

function release(gl: WebGL2RenderingContext, res: Resources): void {
  for (const p of [res.arena, res.markers, res.rings, res.downsample, res.blur, res.composite]) {
    gl.deleteProgram(p.program)
  }
  for (const t of [res.owner, res.nonZero, res.writeAge, res.execAge]) gl.deleteTexture(t)
  for (const v of [res.empty, res.markerVao, res.ringVao]) gl.deleteVertexArray(v)
  gl.deleteBuffer(res.ipBuffer)
  gl.deleteBuffer(res.effectBuffer)
  if (res.targets !== null) releaseTargets(gl, res.targets)
  res.targets = null
}

function releaseTargets(gl: WebGL2RenderingContext, t: Targets): void {
  for (const f of [t.scene, ...t.bloom]) gl.deleteFramebuffer(f)
  for (const x of [t.color, t.glow, ...t.bloomTextures]) gl.deleteTexture(x)
}

function link(gl: WebGL2RenderingContext, vertex: string, fragment: string): Program {
  const program = must(gl.createProgram(), 'a program')
  const shaders = [compile(gl, gl.VERTEX_SHADER, vertex), compile(gl, gl.FRAGMENT_SHADER, fragment)]
  for (const shader of shaders) gl.attachShader(program, shader)
  gl.linkProgram(program)
  for (const shader of shaders) gl.deleteShader(shader)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`arena renderer: a program failed to link: ${log}`)
  }
  const u: Record<string, WebGLUniformLocation> = {}
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i)
    if (info === null) continue
    const location = gl.getUniformLocation(program, info.name)
    if (location !== null) u[info.name.replace(/\[0\]$/, '')] = location
  }
  return { program, u }
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = must(gl.createShader(type), 'a shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`arena renderer: a shader failed to compile: ${log}`)
  }
  return shader
}

/** A uniform's location, or null for one the compiler dropped: setting it then does nothing. */
function uniform(p: Program, name: string): WebGLUniformLocation | null {
  return p.u[name] ?? null
}

/** An integer texture on `unit`, which it stays bound to. */
function dataTexture(
  gl: WebGL2RenderingContext,
  unit: number,
  format: number,
  width: number,
  height: number,
): WebGLTexture {
  const texture = must(gl.createTexture(), 'a texture')
  bindTexture(gl, unit, texture)
  gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height)
  // Integer textures take no filtering.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return texture
}

function texUpload(
  gl: WebGL2RenderingContext,
  unit: number,
  texture: WebGLTexture,
  width: number,
  height: number,
  type: number,
  data: ArrayBufferView,
): void {
  bindTexture(gl, unit, texture)
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED_INTEGER, type, data)
}

/** An RGBA8 render target. Made on the source unit, which holds no data texture. */
function colorTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  filter: number,
): WebGLTexture {
  const texture = must(gl.createTexture(), 'a texture')
  bindTexture(gl, SOURCE_UNIT, texture)
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  bindTexture(gl, SOURCE_UNIT, null)
  return texture
}

/** A framebuffer drawing to `textures`, one color attachment each, in order. */
function framebuffer(
  gl: WebGL2RenderingContext,
  textures: readonly WebGLTexture[],
): WebGLFramebuffer {
  const fb = must(gl.createFramebuffer(), 'a framebuffer')
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
  const attachments = textures.map((texture, i) => {
    const attachment = gl.COLOR_ATTACHMENT0 + i
    gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment, gl.TEXTURE_2D, texture, 0)
    return attachment
  })
  gl.drawBuffers(attachments)
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`arena renderer: a render target is incomplete (0x${status.toString(16)})`)
  }
  return fb
}

function bindTexture(gl: WebGL2RenderingContext, unit: number, texture: WebGLTexture | null): void {
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, texture)
}

function must<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`arena renderer: could not make ${what}`)
  return value
}
