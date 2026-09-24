/**
 * The editor's assembler (src/features/editor/asm): `assembleSource`, the Worker behind
 * `AsmClient` (Bun has a real `Worker`), the fall back to the main thread when the Worker fails,
 * and `useAssembler`'s wait for idle, in jsdom.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_BOT_BYTES } from '@asmbots/asm'
import { act, renderHook } from '@testing-library/react'
import { useDom } from '../../../packages/ui/test/dom'
import { AsmClient } from '../src/features/editor/asm/client'
import type { AsmReply, AsmRequest, AsmResult } from '../src/features/editor/asm/protocol'
import { resultErrors } from '../src/features/editor/asm/protocol'
import { assembleSource } from '../src/features/editor/asm/run'
import { useAssembler } from '../src/features/editor/asm/useAssembler'

useDom()

const DWARF = readFileSync(join(import.meta.dir, '../../../packages/bots/roster/dwarf.asm'), 'utf8')
const bot = (body: string, strategy = '%strategy "test"\n') => `%name "t"\n${strategy}${body}`

const clients: AsmClient[] = []
afterEach(() => {
  for (const client of clients.splice(0)) client.dispose()
})
function client(options?: ConstructorParameters<typeof AsmClient>[0]): AsmClient {
  const made = new AsmClient(options)
  clients.push(made)
  return made
}

describe('assembleSource', () => {
  it('assembles, lints, and measures a bot', () => {
    const result = assembleSource(DWARF)
    expect(result.source).toBe(DWARF)
    expect(resultErrors(result)).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.size).toBe(23)
    expect(result.assembled.bytes.length).toBe(23)
    expect(result.ms).toBeGreaterThanOrEqual(0)
  })

  it('gives the lint warnings beside the errors', () => {
    const result = assembleSource(bot('start:  mov [bx], 0\n        movsb\n', ''))
    expect(resultErrors(result).map((d) => d.code)).toEqual(['size-not-specified'])
    expect(result.warnings.map((d) => d.code).sort()).toEqual(['no-strategy', 'uninitialized-di'])
    expect(result.size).toBeNull()
  })

  it('measures a bot past the cap, whose only error is the cap', () => {
    const result = assembleSource(bot('        times 600 nop\n'))
    expect(resultErrors(result).map((d) => d.code)).toEqual(['size-over-cap'])
    expect(result.assembled.bytes.length).toBe(0)
    expect(result.size).toBe(600)
    expect(result.size).toBeGreaterThan(MAX_BOT_BYTES)
  })

  it('does not measure past the cap when there is another error too', () => {
    const result = assembleSource(bot('        times 600 nop\n        jmp nowhere\n'))
    expect(
      resultErrors(result)
        .map((d) => d.code)
        .sort(),
    ).toEqual(['size-over-cap', 'undefined-symbol'])
    expect(result.size).toBeNull()
  })

  it('says a bot past 64 KB has no size', () => {
    const result = assembleSource(bot('        times 40000 nop\n        times 40000 nop\n'))
    expect(resultErrors(result).map((d) => d.code)).toEqual(['size-over-cap'])
    expect(result.size).toBeNull()
  })
})

describe('AsmClient on the Worker', () => {
  it('assembles in asm.worker.ts, and the result comes back whole', async () => {
    const asm = client()
    expect(asm.inThread).toBe(false)
    const result = await asm.assemble(DWARF)
    const here = assembleSource(DWARF)
    expect(result.source).toBe(DWARF)
    expect(result.size).toBe(here.size)
    expect([...result.assembled.bytes]).toEqual([...here.assembled.bytes])
    expect(result.assembled.symbols).toBeInstanceOf(Map)
    expect([...result.assembled.symbols]).toEqual([...here.assembled.symbols])
    expect(result.assembled.listing.map((l) => [l.lineNo, l.address, l.bytesHex])).toEqual(
      here.assembled.listing.map((l) => [l.lineNo, l.address, l.bytesHex]),
    )
    expect(asm.inThread).toBe(false)
  })

  it('answers each request with its own result, in any order of asking', async () => {
    const asm = client()
    const sources = [DWARF, bot('        nop\n'), bot('        jmp nowhere\n')]
    const results = await Promise.all(sources.map((source) => asm.assemble(source)))
    expect(results.map((r) => r.source)).toEqual(sources)
    expect(results.map((r) => resultErrors(r).length)).toEqual([0, 0, 1])
  })
})

/** A Worker that takes requests and answers nothing until the test says. */
class HeldWorker {
  readonly sent: AsmRequest[] = []
  terminated = false
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>()

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  postMessage(request: AsmRequest): void {
    this.sent.push(request)
  }

  terminate(): void {
    this.terminated = true
  }

  emit(type: string, event: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }

  answer(reply: AsmReply): void {
    this.emit('message', { data: reply })
  }
}

describe('AsmClient without its Worker', () => {
  it('assembles on the main thread when there is no Worker', async () => {
    const asm = client({ worker: null })
    expect(asm.inThread).toBe(true)
    expect((await asm.assemble(DWARF)).size).toBe(23)
  })

  it('moves to the main thread when the Worker fails, the requests in flight too', async () => {
    const worker = new HeldWorker()
    const asm = client({ worker: worker as unknown as Worker })
    const first = asm.assemble(DWARF)
    const second = asm.assemble(bot('        nop\n'))
    expect(worker.sent.map((r) => r.id)).toEqual([1, 2])
    worker.emit('error')
    expect(worker.terminated).toBe(true)
    expect(asm.inThread).toBe(true)
    expect((await first).size).toBe(23)
    expect((await second).size).toBe(1)
    await asm.assemble(DWARF)
    expect(worker.sent).toHaveLength(2)
  })

  it('assembles on the main thread a source the Worker could not', async () => {
    const worker = new HeldWorker()
    const asm = client({ worker: worker as unknown as Worker })
    const pending = asm.assemble(DWARF)
    worker.answer({ id: 1, error: 'boom' })
    expect((await pending).size).toBe(23)
    expect(asm.inThread).toBe(false)
  })

  it('drops an answer to no request, and rejects what is in flight once disposed', async () => {
    const worker = new HeldWorker()
    const asm = client({ worker: worker as unknown as Worker })
    const pending = asm.assemble(DWARF)
    worker.answer({ id: 99, result: assembleSource('') })
    asm.dispose()
    await expect(pending).rejects.toThrow('closed')
    await expect(asm.assemble(DWARF)).rejects.toThrow('closed')
    expect(worker.terminated).toBe(true)
  })
})

/** A client whose answers the test hands out, in any order. */
function heldClient() {
  const asked: { source: string; resolve: (result: AsmResult) => void }[] = []
  const fake = {
    assemble: (source: string) =>
      new Promise<AsmResult>((resolve) => {
        asked.push({ source, resolve })
      }),
  }
  const answer = (index: number) =>
    act(async () => {
      const ask = asked[index] as (typeof asked)[number]
      ask.resolve(assembleSource(ask.source))
    })
  return { fake: fake as unknown as AsmClient, asked, answer }
}

const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))

describe('useAssembler', () => {
  it('assembles the first source at once, then each that rests for the delay', async () => {
    const { fake, asked, answer } = heldClient()
    const { result, rerender } = renderHook(({ source }) => useAssembler(source, fake, 30), {
      initialProps: { source: 'a' },
    })
    expect(asked.map((a) => a.source)).toEqual(['a'])
    expect(result.current.pending).toBe(true)
    await answer(0)
    expect(result.current.result?.source).toBe('a')
    expect(result.current.pending).toBe(false)
    rerender({ source: 'ab' })
    rerender({ source: 'abc' })
    expect(result.current.pending).toBe(true)
    await wait(10)
    rerender({ source: 'abcd' })
    await wait(15)
    expect(asked).toHaveLength(1)
    await wait(30)
    expect(asked.map((a) => a.source)).toEqual(['a', 'abcd'])
    await answer(1)
    expect(result.current.result?.source).toBe('abcd')
    expect(result.current.pending).toBe(false)
  })

  it('keeps only the answer to the last request', async () => {
    const { fake, asked, answer } = heldClient()
    const { result, rerender } = renderHook(({ source }) => useAssembler(source, fake, 5), {
      initialProps: { source: 'one' },
    })
    rerender({ source: 'two' })
    await wait(20)
    expect(asked.map((a) => a.source)).toEqual(['one', 'two'])
    await answer(1)
    await answer(0)
    expect(result.current.result?.source).toBe('two')
  })

  it('asks nothing for text typed back to what was assembled, and drops the answer in flight', async () => {
    const { fake, asked, answer } = heldClient()
    const { result, rerender } = renderHook(({ source }) => useAssembler(source, fake, 5), {
      initialProps: { source: 'one' },
    })
    await answer(0)
    rerender({ source: 'two' })
    await wait(20)
    rerender({ source: 'one' })
    await wait(20)
    expect(asked.map((a) => a.source)).toEqual(['one', 'two'])
    await answer(1)
    expect(result.current.result?.source).toBe('one')
    expect(result.current.pending).toBe(false)
  })

  it('assembles at once on assembleNow, and resolves with the result', async () => {
    const { fake, asked, answer } = heldClient()
    const { result, rerender } = renderHook(({ source }) => useAssembler(source, fake, 10_000), {
      initialProps: { source: 'one' },
    })
    await answer(0)
    rerender({ source: 'two' })
    let done: Promise<AsmResult | null> = Promise.resolve(null)
    act(() => {
      done = result.current.assembleNow()
    })
    expect(asked.map((a) => a.source)).toEqual(['one', 'two'])
    await answer(1)
    expect((await done)?.source).toBe('two')
    expect(result.current.pending).toBe(false)
  })
})
