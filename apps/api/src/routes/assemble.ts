import { assemble } from '@asmbots/asm'
import { AssembleRequest, type AssembleResult, parse, sha256Hex, toBase64 } from '@asmbots/protocol'
import { Hono } from 'hono'
import { jsonBody, limitBody } from '../body'
import type { AppEnv } from '../env'

/**
 * `POST /api/assemble` `{ source }`: the source assembled by the server, so a submission never
 * rests on bytes a client made (ARCHITECTURE §7). A source with an error answers 200 with no
 * bytes and the diagnostics that say why. Rate limited as a write.
 */
export const assembler = new Hono<AppEnv>().post('/', limitBody(256 * 1024), async (c) => {
  const { source } = parse(AssembleRequest, await jsonBody(c), 'the request')
  const out = assemble(source)
  const bytes = out.diagnostics.some((d) => d.severity === 'error') ? null : out.bytes
  return c.json({
    bytes: bytes === null ? null : toBase64(bytes),
    size: bytes?.length ?? 0,
    sha256: bytes === null ? null : await sha256Hex(bytes),
    diagnostics: out.diagnostics,
  } satisfies AssembleResult)
})
