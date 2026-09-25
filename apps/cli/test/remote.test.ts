/**
 * The CLI's network commands (`src/remote.ts`) against a fake `fetch`: the config in a temp home,
 * sign-in, push (a new bot, or a new version of the bot of that name), submit (and `--wait`), and
 * what a 401 says.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  Bot,
  BotVersion,
  HillDetail,
  HillSubmission,
  Me,
  SubmissionDetail,
} from '@asmbots/protocol'
import pkg from '../package.json'
import {
  CLI_VERSION,
  configPath,
  DEFAULT_SERVER,
  type Io,
  parseRemoteArgs,
  readConfig,
  resolveServer,
  runRemote,
  writeConfig,
} from '../src/remote'

const T = '2026-09-25T12:00:00.000Z'
const SERVER = 'http://api.test'
const TOKEN = `asmb_${'ab'.repeat(32)}`
const SPIN = '%name "Spin"\n%author "Tester"\nstart: jmp $\n'

const ME: Me = {
  user: { id: 'u1', handle: 'octo', avatarUrl: null, createdAt: T },
  onboarded: true,
}
const BOT: Bot = {
  id: 'b1',
  ownerId: 'u1',
  slug: 'spin',
  name: 'Spin',
  visibility: 'public',
  createdAt: T,
  updatedAt: T,
}
const version = (n: number): BotVersion => ({
  id: `v${n}`,
  botId: 'b1',
  version: n,
  bytesSha256: 'cd'.repeat(32),
  size: 2,
  author: 'Tester',
  strategy: null,
  isa: 'x16c-v1',
  createdAt: T,
})

interface Call {
  method: string
  path: string
  headers: Record<string, string>
  body: unknown
}

/** A fake server: `routes` by `METHOD /path` (under `/api`), each a JSON answer or a function. */
function fakeFetch(routes: Record<string, unknown | ((call: Call) => [number, unknown])>) {
  const calls: Call[] = []
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const path = url.slice(`${SERVER}/api`.length)
    const call: Call = {
      method: init.method ?? 'GET',
      path,
      headers: init.headers as Record<string, string>,
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    }
    calls.push(call)
    const route = routes[`${call.method} ${path}`]
    if (route === undefined) {
      return Response.json(
        { error: { code: 'not_found', message: `no route ${path}` } },
        { status: 404 },
      )
    }
    const [status, body] = typeof route === 'function' ? route(call) : [200, route]
    return Response.json(body, { status })
  }
  return { fetch, calls }
}

let home = ''
let dir = ''
let out: string[] = []
let err: string[] = []

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'asmbots-home-'))
  dir = mkdtempSync(join(tmpdir(), 'asmbots-bots-'))
  out = []
  err = []
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(dir, { recursive: true, force: true })
})

function io(fetch: Io['fetch'], more: Partial<Io> = {}): Io {
  return {
    fetch,
    env: {},
    home,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    readLine: async () => '',
    sleep: async () => {},
    ...more,
  }
}

/** Writes `source` to `<dir>/<name>` and returns its path. */
function botFile(name: string, source: string): string {
  const path = join(dir, name)
  writeFileSync(path, source)
  return path
}

function signedIn(): void {
  writeConfig(home, { server: SERVER, token: TOKEN })
}

describe('the config', () => {
  it('is written only its owner may read, and read back', () => {
    writeConfig(home, { server: SERVER, token: TOKEN })
    expect(statSync(configPath(home)).mode & 0o777).toBe(0o600)
    expect(statSync(join(home, '.config', 'asmbots')).mode & 0o777).toBe(0o700)
    expect(readConfig(home)).toEqual({ server: SERVER, token: TOKEN })
  })

  it('reads as empty when missing or not JSON', () => {
    expect(readConfig(home)).toEqual({})
    writeConfig(home, {})
    writeFileSync(configPath(home), 'not json')
    expect(readConfig(home)).toEqual({})
  })

  it('names the server by --server, then ASMBOTS_SERVER, then the config, then asmbots.io', () => {
    const env = (ASMBOTS_SERVER?: string) => io(fakeFetch({}).fetch, { env: { ASMBOTS_SERVER } })
    expect(resolveServer('http://flag.test/', env('http://env.test'), { server: 'x' })).toBe(
      'http://flag.test',
    )
    expect(resolveServer(undefined, env('http://env.test'), { server: 'http://c.test' })).toBe(
      'http://env.test',
    )
    expect(resolveServer(undefined, env(), { server: 'http://c.test' })).toBe('http://c.test')
    expect(resolveServer(undefined, env(), {})).toBe(DEFAULT_SERVER)
  })

  it('keeps a switch from eating the word after it', () => {
    expect(parseRemoteArgs(['--wait', 'main', 'bot.asm', '--name', 'X'])).toEqual({
      args: ['main', 'bot.asm'],
      flags: { wait: true, name: 'X' },
    })
  })

  it('says the version package.json says', () => {
    expect(CLI_VERSION).toBe(pkg.version)
  })
})

describe('asmbots login', () => {
  it('checks the token with GET /api/me, then saves it', async () => {
    const server = fakeFetch({ 'GET /me': ME })
    const code = await runRemote(
      'login',
      ['--token', TOKEN, '--server', `${SERVER}/`],
      io(server.fetch),
    )
    expect(code).toBe(0)
    expect(out).toEqual([`signed in as octo on ${SERVER}`])
    expect(server.calls[0]?.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
      'User-Agent': `asmbots-cli/${CLI_VERSION}`,
    })
    expect(readConfig(home)).toEqual({ server: SERVER, token: TOKEN })
  })

  it('reads the token from stdin without --token', async () => {
    const server = fakeFetch({ 'GET /me': ME })
    const code = await runRemote(
      'login',
      ['--server', SERVER],
      io(server.fetch, { readLine: async () => `  ${TOKEN}  ` }),
    )
    expect(code).toBe(0)
    expect(readConfig(home).token).toBe(TOKEN)
  })

  it('refuses what is not a token, and saves nothing the server refuses', async () => {
    const server = fakeFetch({
      'GET /me': () => [
        401,
        { error: { code: 'unauthorized', message: 'the api token is not valid' } },
      ],
    })
    expect(
      await runRemote('login', ['--token', 'nope', '--server', SERVER], io(server.fetch)),
    ).toBe(1)
    expect(err).toEqual(['error: that is not an api token: it is asmb_ and 64 hex digits'])
    expect(server.calls).toEqual([])
    expect(await runRemote('login', ['--token', TOKEN, '--server', SERVER], io(server.fetch))).toBe(
      1,
    )
    expect(err[1]).toBe('error: the api token is not valid: run asmbots login')
    expect(readConfig(home)).toEqual({})
  })
})

describe('asmbots logout and whoami', () => {
  it('whoami names the user; logout forgets the token and keeps the server', async () => {
    signedIn()
    const server = fakeFetch({ 'GET /me': ME })
    expect(await runRemote('whoami', [], io(server.fetch))).toBe(0)
    expect(out).toEqual([`octo on ${SERVER}`])
    expect(await runRemote('logout', [], io(server.fetch))).toBe(0)
    expect(readConfig(home)).toEqual({ server: SERVER })
    expect(await runRemote('whoami', [], io(server.fetch))).toBe(1)
    expect(err.at(-1)).toBe('error: not signed in: run asmbots login (or set ASMBOTS_TOKEN)')
  })

  it('takes the token from ASMBOTS_TOKEN over the config', async () => {
    signedIn()
    const server = fakeFetch({ 'GET /me': ME })
    const other = `asmb_${'01'.repeat(32)}`
    await runRemote('whoami', [], io(server.fetch, { env: { ASMBOTS_TOKEN: other } }))
    expect(server.calls[0]?.headers.Authorization).toBe(`Bearer ${other}`)
  })
})

describe('asmbots push', () => {
  it('makes a new public bot named by %name when the user has none of that name', async () => {
    signedIn()
    const server = fakeFetch({
      'GET /me/bots': { bots: [{ bot: { ...BOT, id: 'b0', name: 'Other' }, latest: null }] },
      'POST /bots': () => [201, { bot: BOT, version: version(1) }],
    })
    const file = botFile('spin.asm', SPIN)
    expect(await runRemote('push', [file], io(server.fetch))).toBe(0)
    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /me/bots', 'POST /bots'])
    expect(server.calls[1]?.body).toEqual({ name: 'Spin', source: SPIN, visibility: 'public' })
    expect(out).toEqual(['made Spin v1 (public)', 'bot b1, version v1', `${SERVER}/bots/b1`])
  })

  it('adds a version to the bot of that name', async () => {
    signedIn()
    const server = fakeFetch({
      'GET /me/bots': { bots: [{ bot: BOT, latest: version(1) }] },
      'POST /bots/b1/versions': () => [201, { bot: BOT, version: version(2), created: true }],
    })
    const file = botFile('spin.asm', SPIN)
    expect(await runRemote('push', [file], io(server.fetch))).toBe(0)
    expect(server.calls[1]).toMatchObject({ path: '/bots/b1/versions', body: { source: SPIN } })
    expect(out[0]).toBe('new version of Spin v2 (public)')
  })

  it('names the bot by --name, else its file when the source has no %name', async () => {
    signedIn()
    const server = fakeFetch({
      'GET /me/bots': { bots: [] },
      'POST /bots': () => [201, { bot: BOT, version: version(1) }],
    })
    const file = botFile('spin.asm', SPIN)
    await runRemote(
      'push',
      [file, '--name', 'Spinner', '--visibility', 'private'],
      io(server.fetch),
    )
    expect(server.calls[1]?.body).toMatchObject({ name: 'Spinner', visibility: 'private' })
  })

  it('sends nothing for a source that does not assemble, and prints why', async () => {
    signedIn()
    const server = fakeFetch({})
    const file = botFile('bad.asm', '%name "Bad"\nstart: frobnicate ax\n')
    expect(await runRemote('push', [file], io(server.fetch))).toBe(1)
    expect(server.calls).toEqual([])
    expect(err[0]).toContain('bad.asm:2:')
    expect(err.at(-1)).toContain('does not assemble: nothing was sent')
  })

  it('says to sign in on a 401', async () => {
    signedIn()
    const server = fakeFetch({
      'GET /me/bots': () => [
        401,
        { error: { code: 'unauthorized', message: 'the api token is not valid' } },
      ],
    })
    expect(await runRemote('push', [botFile('spin.asm', SPIN)], io(server.fetch))).toBe(1)
    expect(err).toEqual(['error: the api token is not valid: run asmbots login'])
  })

  it("prints the API's message for any other refusal", async () => {
    signedIn()
    const server = fakeFetch({
      'GET /me/bots': { bots: [] },
      'POST /bots': () => [
        409,
        { error: { code: 'conflict', message: 'an account holds 200 bots' } },
      ],
    })
    expect(await runRemote('push', [botFile('spin.asm', SPIN)], io(server.fetch))).toBe(1)
    expect(err).toEqual(['error: an account holds 200 bots'])
  })
})

describe('asmbots submit', () => {
  const pushed = {
    'GET /me/bots': { bots: [] },
    'POST /bots': () => [201, { bot: BOT, version: version(1) }] as [number, unknown],
    'POST /hills/main/submit': () =>
      [201, { submissionId: 's1', liveRoom: 'hill:h1' }] as [number, unknown],
  }

  it('pushes the bot, then submits that version', async () => {
    signedIn()
    const server = fakeFetch(pushed)
    expect(await runRemote('submit', ['main', botFile('spin.asm', SPIN)], io(server.fetch))).toBe(0)
    expect(server.calls.at(-1)).toMatchObject({
      method: 'POST',
      path: '/hills/main/submit',
      body: { botVersionId: 'v1' },
    })
    expect(out.slice(-2)).toEqual([
      'submitted Spin v1 to main: submission s1',
      `${SERVER}/hills/main?submission=s1`,
    ])
  })

  it('with --wait, follows the submission to its end and prints rank, move, and rating', async () => {
    signedIn()
    const submission = (status: HillSubmission['status']): HillSubmission => ({
      id: 's1',
      hillId: 'h1',
      botVersionId: 'v1',
      status,
      score: status === 'finished' ? 12 : null,
      rank: status === 'finished' ? 3 : null,
      needed: null,
      createdAt: T,
    })
    const answers: SubmissionDetail[] = [
      { submission: submission('queued'), bot: null, progress: null, matches: [], events: [] },
      {
        submission: submission('running'),
        bot: null,
        progress: { done: 4, of: 10, next: null },
        matches: [],
        events: [],
      },
      {
        submission: submission('finished'),
        bot: null,
        progress: null,
        matches: [],
        events: [
          {
            event: {
              id: 'e1',
              hillId: 'h1',
              submissionId: 's1',
              kind: 'entered',
              botVersionId: 'v1',
              rank: 3,
              score: 12,
              delta: 2,
              at: T,
            },
            bot: null,
          },
        ],
      },
    ]
    const label = {
      botId: 'b1',
      versionId: 'v1',
      slug: 'spin',
      name: 'Spin',
      version: 1,
      owner: 'octo',
      author: null,
    }
    const hill: HillDetail = {
      hill: {
        id: 'h1',
        slug: 'main',
        name: 'main',
        description: '',
        size: 32,
        rounds: 3,
        config: {
          coreSize: 65536,
          maxCycles: 1000,
          maxProcesses: 64,
          minSpacing: 1024,
          maxBotBytes: 512,
        },
        scoring: 'duel',
        createdAt: T,
      },
      standings: [
        {
          entry: {
            hillId: 'h1',
            botVersionId: 'v1',
            score: 12,
            rating: 1612.4,
            wins: 3,
            ties: 0,
            losses: 1,
            age: 0,
            enteredAt: T,
            rank: 3,
            reign: null,
          },
          bot: label,
          rd: 88.2,
        },
      ],
    }
    let polls = 0
    const server = fakeFetch({
      ...pushed,
      'GET /hills/main/submissions/s1': () => [200, answers[Math.min(polls++, 2)]],
      'GET /hills/main': hill,
    })
    const code = await runRemote(
      'submit',
      ['main', botFile('spin.asm', SPIN), '--wait'],
      io(server.fetch),
    )
    expect(code).toBe(0)
    expect(polls).toBe(3)
    expect(out.slice(-4)).toEqual([
      'queued',
      'fighting 4 of 10',
      'entered main at rank 3 (up 2), score 12',
      'rating 1612 ± 88',
    ])
    expect(server.calls.at(-1)?.headers['Cache-Control']).toBe('no-cache')
  })

  it('needs a hill and a file', async () => {
    signedIn()
    expect(await runRemote('submit', ['main'], io(fakeFetch({}).fetch))).toBe(1)
    expect(err[0]).toContain('submit needs a hill and a bot file')
  })
})

describe('the saved config file', () => {
  it('holds exactly the server and the token', async () => {
    const server = fakeFetch({ 'GET /me': ME })
    await runRemote('login', ['--token', TOKEN, '--server', SERVER], io(server.fetch))
    expect(JSON.parse(readFileSync(configPath(home), 'utf8'))).toEqual({
      server: SERVER,
      token: TOKEN,
    })
  })
})
