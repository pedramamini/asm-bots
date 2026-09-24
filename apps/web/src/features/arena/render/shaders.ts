/**
 * The arena's GLSL ES 3.00 programs (DESIGN_SYSTEM §5), which `gl.ts` compiles. Coordinates are
 * device px from the target's top-left corner; `gl_FragCoord` counts from the bottom, so each
 * shader flips it with `uHeight`. The constants come from `scene.ts` and the kit's palette layout,
 * so the WebGL2 renderer and the 2D one agree.
 *
 * - `QUAD_VERT`: a triangle that covers the target, for the full-screen passes.
 * - `ARENA_FRAG`: the core, cell by cell: territory, exec trail, write flash, lattice. The bots
 *   not isolated (`uDim`) keep a share of their light, their IPs and rings too.
 * - `MARKER_*`: an IP marker per live process, instanced.
 * - `RING_*`: death ripples and spawn pulses, instanced.
 * - `DOWNSAMPLE_FRAG`, `BLUR_FRAG`, `COMPOSITE_FRAG`: bloom, scanlines, and the vignette.
 *
 * The scene's programs write two targets: the color, and the emissive light alone (trails,
 * flashes, IPs, rings), which bloom blurs.
 */

import { PALETTE_INDEX, PALETTE_ROWS } from '@asmbots/ui/themes'
import { IP_FRONT } from '../worker/protocol'
import {
  EXEC_FADE_MS,
  GLOW_MS,
  OWNED,
  OWNED_ZERO,
  PULSE,
  PULSE_MS,
  RIPPLE_MS,
  SIDE,
  WRITE_FADE_MS,
} from './scene'

/** A number as a GLSL float literal. */
function f(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`
}

/** The bot hues: the palette's first rows. */
const HUES = PALETTE_INDEX.bg - PALETTE_INDEX.bot

const HEADER = `#version 300 es
precision highp float;
precision highp int;
`

/** The palette rows (`getPaletteFloat32`), as GLSL constants. */
const PALETTE = `
uniform vec4 uPalette[${PALETTE_ROWS}];
const int BOT = ${PALETTE_INDEX.bot};
const int HUES = ${HUES};
const int BG = ${PALETTE_INDEX.bg};
const int LATTICE = ${PALETTE_INDEX.lattice};
const int IP = ${PALETTE_INDEX.ip};
const int EXEC = ${PALETTE_INDEX.exec};
const int WRITE = ${PALETTE_INDEX.write};

vec3 hue(int bot) {
  return uPalette[BOT + bot % HUES].rgb;
}
`

/**
 * Per owner tag, 4 a row: the share of its light a bot keeps, 1, or `ISOLATE_DIM` while other
 * bots are isolated (`ArenaScene.dim`).
 */
const DIM = `
uniform vec4 uDim[64];

float dimOf(uint tag) {
  return uDim[int(tag >> 2u)][int(tag & 3u)];
}
`

/** Device px (top-left origin) to clip space, for a target `uSize` px. */
const CLIP = `
vec4 clip(vec2 p) {
  return vec4(p.x / uSize.x * 2.0 - 1.0, 1.0 - p.y / uSize.y * 2.0, 0.0, 1.0);
}
`

export const QUAD_VERT = `${HEADER}
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`

export const ARENA_FRAG = `${HEADER}
precision highp usampler2D;
${PALETTE}
// The owner tag per byte: 0 for nobody, else bot index + 1. R8UI, 256 x 256.
uniform usampler2D uOwner;
// Bit (col & 7) of texel (col >> 3, row) is set for a non-zero byte. R8UI, 32 x 256.
uniform usampler2D uNonZero;
// ms since each byte was last written, and run. R16UI, 256 x 256.
uniform usampler2D uWriteAge;
uniform usampler2D uExecAge;
// Per owner tag, 4 a row: the share of the hue's saturation lost (a dead bot's territory).
uniform vec4 uFade[64];
${DIM}
// Cell (0, 0)'s top-left corner, and px per cell.
uniform vec2 uOrigin;
uniform float uCell;
uniform float uHeight;
// The lattice's line width, px: 0 for none.
uniform float uLattice;
// 1 draws the trails and flashes; 0 draws the owner map alone (the minimap).
uniform float uGlow;

layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outGlow;

float glowOf(uint age, float fade) {
  float a = float(age);
  return a >= ${f(GLOW_MS)} ? 0.0 : exp(-a / fade);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uHeight - gl_FragCoord.y);
  vec2 q = (p - uOrigin) / uCell;
  vec3 bg = uPalette[BG].rgb;
  outGlow = vec4(0.0);
  if (q.x < 0.0 || q.y < 0.0 || q.x >= ${f(SIDE)} || q.y >= ${f(SIDE)}) {
    outColor = vec4(bg, 1.0);
    return;
  }
  ivec2 at = ivec2(q);
  uint tag = texelFetch(uOwner, at, 0).r;
  vec3 color = bg;
  if (tag != 0u) {
    uint bits = texelFetch(uNonZero, ivec2(at.x >> 3, at.y), 0).r;
    bool nonZero = ((bits >> uint(at.x & 7)) & 1u) == 1u;
    vec3 h = hue(int(tag) - 1);
    float fade = uFade[int(tag >> 2u)][int(tag & 3u)];
    h = mix(h, vec3(dot(h, vec3(0.2126, 0.7152, 0.0722))), fade);
    color = mix(bg, h, nonZero ? ${f(OWNED)} : ${f(OWNED_ZERO)});
  }
  if (uGlow > 0.0) {
    float exec = glowOf(texelFetch(uExecAge, at, 0).r, ${f(EXEC_FADE_MS)});
    float write = glowOf(texelFetch(uWriteAge, at, 0).r, ${f(WRITE_FADE_MS)});
    vec3 execColor = uPalette[EXEC].rgb;
    vec3 writeColor = uPalette[WRITE].rgb;
    color = mix(color, execColor, exec);
    color = mix(color, writeColor, write);
    outGlow = vec4(min(execColor * exec + writeColor * write, 1.0), 1.0);
  }
  float keep = dimOf(tag);
  color = mix(bg, color, keep);
  outGlow.rgb *= keep;
  if (uLattice > 0.0) {
    vec2 into = (q - vec2(at)) * uCell;
    if ((into.x < uLattice && at.x > 0) || (into.y < uLattice && at.y > 0)) {
      color = uPalette[LATTICE].rgb;
      outGlow = vec4(0.0);
    }
  }
  outColor = vec4(color, 1.0);
}
`

export const MARKER_VERT = `${HEADER}
// A live process: (IP, bot | IP_FRONT), FrameMessage.ips.
layout(location = 0) in uvec2 aProc;
uniform vec2 uOrigin;
uniform float uCell;
uniform vec2 uSize;
uniform float uRatio;
// px from the cell's top-left corner.
out vec2 vAt;
flat out float vFront;
flat out float vDim;
${CLIP}
${DIM}
void main() {
  // The outline (1 px) and the glow (2 px) around the cell.
  float pad = 3.0 * uRatio;
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 cell = vec2(float(aProc.x & 255u), float(aProc.x >> 8u));
  vec2 topLeft = uOrigin + cell * uCell;
  vec2 p = topLeft - pad + corner * (uCell + 2.0 * pad);
  vAt = p - topLeft;
  vFront = (aProc.y & ${IP_FRONT}u) != 0u ? 1.0 : 0.0;
  vDim = dimOf((aProc.y & 255u) + 1u);
  gl_Position = clip(p);
}
`

export const MARKER_FRAG = `${HEADER}
${PALETTE}
uniform float uCell;
uniform float uRatio;
in vec2 vAt;
flat in float vFront;
flat in float vDim;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outGlow;

void main() {
  // Signed distance from the cell's edge, px: below 0 inside, where the cell shows through.
  vec2 half_ = vec2(uCell * 0.5);
  vec2 d = abs(vAt - half_) - half_;
  float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  if (dist < 0.0) discard;
  float a = dist < uRatio ? 1.0 : 0.5 * exp(-(dist - uRatio) / (0.7 * uRatio));
  // The process that runs next is the brighter.
  a *= (vFront > 0.5 ? 1.0 : 0.55) * vDim;
  if (a < 0.004) discard;
  vec3 ip = uPalette[IP].rgb;
  outColor = vec4(ip * a, a);
  outGlow = vec4(ip * a, a);
}
`

export const RING_VERT = `${HEADER}
// An effect: column, row, start (ms), code (kind << 8 | bot): ArenaScene.effects.
layout(location = 0) in vec4 aEffect;
uniform vec2 uOrigin;
uniform float uCell;
uniform vec2 uSize;
uniform float uRatio;
uniform float uNow;
// px from the ring's center.
out vec2 vAt;
flat out float vT;
flat out float vRadius;
flat out int vKind;
flat out int vBot;
${CLIP}
void main() {
  int code = int(aEffect.w);
  vKind = code >> 8;
  vBot = code & 255;
  bool pulse = vKind == ${PULSE};
  vT = (uNow - aEffect.z) / (pulse ? ${f(PULSE_MS)} : ${f(RIPPLE_MS)});
  if (vT < 0.0 || vT >= 1.0) {
    // Over, or not begun: off the target.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  // A few cells out at zoom 1, near two cells when zoomed far in (ringReach in canvas2d.ts).
  vRadius = pulse
    ? max(7.0 * uRatio, min(2.5 * uCell, uCell + 12.0 * uRatio))
    : max(12.0 * uRatio, min(4.0 * uCell, 1.5 * uCell + 24.0 * uRatio));
  float extent = vRadius + 2.0 * uRatio;
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  vAt = corner * extent;
  gl_Position = clip(uOrigin + (aEffect.xy + 0.5) * uCell + vAt);
}
`

export const RING_FRAG = `${HEADER}
${PALETTE}
${DIM}
uniform float uCell;
uniform float uRatio;
in vec2 vAt;
flat in float vT;
flat in float vRadius;
flat in int vKind;
flat in int vBot;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outGlow;

void main() {
  bool pulse = vKind == ${PULSE};
  // Outward, fast then slow, and fading as it goes.
  float eased = 1.0 - (1.0 - vT) * (1.0 - vT);
  float radius = mix(0.5 * uCell, vRadius, eased);
  float width = (pulse ? 1.0 : 1.5) * uRatio;
  float a = (1.0 - vT) * clamp(1.0 - abs(length(vAt) - radius) / width, 0.0, 1.0);
  a *= dimOf(uint(vBot) + 1u);
  if (a < 0.004) discard;
  vec3 color = pulse ? mix(hue(vBot), vec3(1.0), 0.5) : hue(vBot);
  outColor = vec4(color * a, a);
  outGlow = vec4(color * a, a);
}
`

/** Quarter size: each output texel is the mean of a 4 x 4 block, four bilinear reads. */
export const DOWNSAMPLE_FRAG = `${HEADER}
uniform sampler2D uSource;
// 1 / the source's size.
uniform vec2 uTexel;
out vec4 outColor;

void main() {
  vec2 center = gl_FragCoord.xy * 4.0 * uTexel;
  vec3 c = texture(uSource, center + vec2(-1.0, -1.0) * uTexel).rgb;
  c += texture(uSource, center + vec2(1.0, -1.0) * uTexel).rgb;
  c += texture(uSource, center + vec2(-1.0, 1.0) * uTexel).rgb;
  c += texture(uSource, center + vec2(1.0, 1.0) * uTexel).rgb;
  outColor = vec4(c * 0.25, 1.0);
}
`

/** A 9-tap Gaussian along `uStep`, in five bilinear reads. */
export const BLUR_FRAG = `${HEADER}
uniform sampler2D uSource;
// 1 / the target's size.
uniform vec2 uTexel;
// One texel along the blur: across, or down.
uniform vec2 uStep;
out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec3 c = texture(uSource, uv).rgb * 0.2270270270;
  vec2 near = uStep * 1.3846153846;
  vec2 far = uStep * 3.2307692308;
  c += (texture(uSource, uv + near).rgb + texture(uSource, uv - near).rgb) * 0.3162162162;
  c += (texture(uSource, uv + far).rgb + texture(uSource, uv - far).rgb) * 0.0702702703;
  outColor = vec4(c, 1.0);
}
`

export const COMPOSITE_FRAG = `${HEADER}
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uSize;
uniform float uRatio;
uniform float uBloomStrength;
uniform float uScanlines;
uniform float uVignette;
out vec4 outColor;

void main() {
  vec3 color = texelFetch(uScene, ivec2(gl_FragCoord.xy), 0).rgb;
  vec2 uv = gl_FragCoord.xy / uSize;
  if (uBloomStrength > 0.0) color += texture(uBloom, uv).rgb * uBloomStrength;
  if (uScanlines > 0.0) {
    // A soft dark line every 3 CSS px, counted from the top.
    float y = (uSize.y - gl_FragCoord.y) / uRatio;
    color *= 1.0 - uScanlines * (0.5 + 0.5 * cos(y * 2.0943951));
  }
  if (uVignette > 0.0) {
    // An ellipse the canvas's shape: the edges' middles dim a little, the corners most.
    color *= 1.0 - uVignette * smoothstep(0.35, 0.75, length(uv - 0.5));
  }
  outColor = vec4(color, 1.0);
}
`
