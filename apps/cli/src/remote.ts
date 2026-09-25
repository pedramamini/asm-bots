/**
 * The CLI's network commands: sign in with a personal API token, push bots to the server, submit
 * them to hills, and list the hills. They talk to `https://asmbots.io` (or `--server`,
 * `ASMBOTS_SERVER`, the saved server) with `Authorization: Bearer <token>`. Global `fetch` and
 * `node:fs`, `node:os`, `node:path` only, so the bundled CLI runs under plain Node.
 *
 *   asmbots login [--token <t>] [--server <url>]
 *   asmbots logout
 *   asmbots whoami
 *   asmbots push <bot.asm> [--name <n>] [--visibility public|unlisted|private]
 *   asmbots submit <hill> <bot.asm> [--wait] [--name <n>] [--visibility ...]
 *   asmbots hills
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { assemble, formatDiag } from '@asmbots/asm'
import {
  API_TOKEN,
  ApiError,
  HillDetail,
  HillList,
  HillSubmitted,
  Me,
  MyBotList,
  parse,
  SavedBot,
  SavedBotVersion,
  SubmissionDetail,
  UpdatedBot,
} from '@asmbots/protocol'

/** The CLI's version, as its `User-Agent` says it: `asmbots-cli/<version>`. */
export const CLI_VERSION = '0.1.0'

/** The server when nothing names another. */
export const DEFAULT_SERVER = 'https://asmbots.io'

/** The commands this file answers. */
export const REMOTE_COMMANDS = ['login', 'logout', 'whoami', 'push', 'submit', 'hills'] as const

/** How often `submit --wait` asks how the submission is going, and for how long at most. */
const POLL_MS = 2000
const POLL_TRIES = (5 * 60 * 1000) / POLL_MS

const VISIBILITIES = ['public', 'unlisted', 'private'] as const
type Visibility = (typeof VISIBILITIES)[number]

/** What the commands touch outside themselves; a test gives its own. */
export interface Io {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  env: Record<string, string | undefined>
  /** The home directory: the config is `<home>/.config/asmbots/config.json`. */
  home: string
  out: (line: string) => void
  err: (line: string) => void
  /** One line from stdin, for `login` without `--token`. */
  readLine: () => Promise<string>
  sleep: (ms: number) => Promise<void>
}

/** The real world: global `fetch`, `process.env`, the console, stdin, timers. */
export function defaultIo(): Io {
  return {
    fetch: (url, init) => fetch(url, init),
    env: process.env,
    home: homedir(),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    readLine: readStdinLine,
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  }
}

/** Reads stdin up to its first newline (or its end): a token pasted in, or piped. */
async function readStdinLine(): Promise<string> {
  const decoder = new TextDecoder()
  let text = ''
  for await (const chunk of process.stdin) {
    text += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    if (text.includes('\n')) break
  }
  return text.split('\n')[0] ?? ''
}

/** What `login` saves. */
export interface Config {
  server?: string
  token?: string
}

/** Where the config lives: `<home>/.config/asmbots/config.json`. */
export function configPath(home: string): string {
  return join(home, '.config', 'asmbots', 'config.json')
}

/** The saved config; empty when there is none, or it is not JSON. */
export function readConfig(home: string): Config {
  try {
    const value: unknown = JSON.parse(readFileSync(configPath(home), 'utf8'))
    if (typeof value !== 'object' || value === null) return {}
    const { server, token } = value as Record<string, unknown>
    return {
      ...(typeof server === 'string' && { server }),
      ...(typeof token === 'string' && { token }),
    }
  } catch {
    return {}
  }
}

/** Saves `config`: the directory only its owner may enter (0700), the file only they read (0600). */
export function writeConfig(home: string, config: Config): void {
  const path = configPath(home)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  chmodSync(dirname(path), 0o700)
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
}

/** `url` without its trailing slashes: `https://asmbots.io`. */
function trimServer(url: string): string {
  return url.replace(/\/+$/, '')
}

/** The server: `--server`, else `ASMBOTS_SERVER`, else the saved one, else `DEFAULT_SERVER`. */
export function resolveServer(flag: string | undefined, io: Io, config: Config): string {
  return trimServer(flag ?? io.env.ASMBOTS_SERVER ?? config.server ?? DEFAULT_SERVER)
}

/** The token: `ASMBOTS_TOKEN`, else the saved one; null when there is neither. */
export function resolveToken(io: Io, config: Config): string | null {
  return io.env.ASMBOTS_TOKEN || config.token || null
}

/** A command that cannot go on: its message, printed as `error: ...`, and exit 1. */
export class RemoteError extends Error {
  override readonly name = 'RemoteError'
  constructor(
    message: string,
    /** The HTTP status; 0 when there was no answer. */
    readonly status = 0,
  ) {
    super(message)
  }
}

/** The command line after the command: positional words and `--flag value` / `--flag`. */
export interface RemoteArgs {
  args: string[]
  flags: Record<string, string | true>
}

/** Flags that take no value, so the word after one stays a positional argument. */
const SWITCHES = new Set(['wait', 'help', 'no-color'])

/** Reads `argv` (after the command): `--flag=value`, `--flag value`, or a switch alone. */
export function parseRemoteArgs(argv: readonly string[]): RemoteArgs {
  const args: string[] = []
  const flags: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i] as string
    if (!word.startsWith('--')) {
      args.push(word)
      continue
    }
    const [flag = '', ...value] = word.slice(2).split('=')
    const next = argv[i + 1]
    if (value.length > 0) flags[flag] = value.join('=')
    else if (!SWITCHES.has(flag) && next !== undefined && !next.startsWith('--')) {
      flags[flag] = next
      i++
    } else flags[flag] = true
  }
  return { args, flags }
}

/** The string value of `--flag`, or undefined; a bare `--flag` that wants a value is an error. */
function flagValue(flags: RemoteArgs['flags'], flag: string): string | undefined {
  const value = flags[flag]
  if (value === true) throw new RemoteError(`--${flag} needs a value`)
  return value
}

/** A signed-in (or not) client of one server. */
export class Client {
  constructor(
    readonly server: string,
    readonly token: string | null,
    private readonly io: Io,
  ) {}

  /** The token, or the error that says how to get one. */
  private bearer(): string {
    if (this.token === null) {
      throw new RemoteError('not signed in: run asmbots login (or set ASMBOTS_TOKEN)', 401)
    }
    return this.token
  }

  /**
   * `method` `path` (under `/api`) with `body` as JSON, the answer read by `read`. A refusal is a
   * `RemoteError` with the API's message; a 401 adds how to sign in.
   */
  async call<T>(
    method: string,
    path: string,
    read: (value: unknown) => T,
    { body, auth = true, fresh = false }: { body?: unknown; auth?: boolean; fresh?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': `asmbots-cli/${CLI_VERSION}`,
    }
    if (auth) headers.Authorization = `Bearer ${this.bearer()}`
    else if (this.token !== null) headers.Authorization = `Bearer ${this.token}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (fresh) headers['Cache-Control'] = 'no-cache'
    let res: Response
    try {
      res = await this.io.fetch(`${this.server}/api${path}`, {
        method,
        headers,
        ...(body !== undefined && { body: JSON.stringify(body) }),
      })
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      throw new RemoteError(`could not reach ${this.server}: ${why}`)
    }
    const value: unknown = await res.json().catch(() => undefined)
    if (!res.ok) {
      const shaped = ApiError.safeParse(value)
      const message = shaped.success
        ? shaped.data.error.message
        : `${this.server} answered ${res.status}`
      if (res.status === 401) throw new RemoteError(`${message}: run asmbots login`, 401)
      throw new RemoteError(message, res.status)
    }
    try {
      return read(value)
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      throw new RemoteError(`${this.server} answered something this CLI does not read: ${why}`)
    }
  }

  /** `GET /api/me`: who the token signs in. */
  me(): Promise<Me> {
    return this.call('GET', '/me', (v) => parse(Me, v, 'your account'))
  }
}

/** A client of the resolved server with the resolved token. */
function clientOf(flags: RemoteArgs['flags'], io: Io): Client {
  const config = readConfig(io.home)
  return new Client(
    resolveServer(flagValue(flags, 'server'), io, config),
    resolveToken(io, config),
    io,
  )
}

/** `asmbots login [--token <t>] [--server <url>]`: checks the token, then saves it. */
async function login({ flags }: RemoteArgs, io: Io): Promise<number> {
  const config = readConfig(io.home)
  const server = resolveServer(flagValue(flags, 'server'), io, config)
  let token = flagValue(flags, 'token')
  if (token === undefined) {
    io.err(`paste an api token (make one at ${server}/settings), then press enter:`)
    token = await io.readLine()
  }
  token = token.trim()
  if (!API_TOKEN.test(token)) {
    throw new RemoteError('that is not an api token: it is asmb_ and 64 hex digits')
  }
  const me = await new Client(server, token, io).me()
  writeConfig(io.home, { server, token })
  io.out(`signed in as ${me.user.handle} on ${server}`)
  return 0
}

/** `asmbots logout`: forgets the saved token (the server keeps it until it is revoked). */
function logout(io: Io): number {
  const config = readConfig(io.home)
  if (config.token === undefined) {
    io.out('not signed in')
    return 0
  }
  if (config.server === undefined) rmSync(configPath(io.home), { force: true })
  else writeConfig(io.home, { server: config.server })
  io.out('signed out: the token is forgotten here. revoke it on the settings page to end it')
  return 0
}

/** `asmbots whoami`: the handle the token signs in, and the server. */
async function whoami({ flags }: RemoteArgs, io: Io): Promise<number> {
  const client = clientOf(flags, io)
  const me = await client.me()
  io.out(`${me.user.handle} on ${client.server}`)
  return 0
}

/** A bot file, assembled here: its source and its name (`--name`, else `%name`, else the file). */
export interface LocalBot {
  path: string
  source: string
  name: string
}

/** Reads and assembles `file`; its errors are printed and refused before anything is sent. */
export function localBot(file: string, nameFlag: string | undefined, io: Io): LocalBot {
  const path = resolve(file)
  if (!existsSync(path)) throw new RemoteError(`no such file: ${file}`)
  const source = readFileSync(path, 'utf8')
  const made = assemble(source)
  const errors = made.diagnostics.filter((d) => d.severity === 'error')
  if (errors.length > 0) {
    for (const d of errors) io.err(formatDiag(d, file))
    throw new RemoteError(`${file} does not assemble: nothing was sent`)
  }
  const name = (nameFlag ?? (made.name || basename(path).replace(/\.asm$/i, ''))).trim()
  if (!/^[^\n\r]{1,64}$/.test(name)) throw new RemoteError('a bot name is 1..64 characters')
  return { path, source, name }
}

/** What a push did: the bot, its version, and whether this push made the version. */
export interface Pushed {
  bot: SavedBot['bot']
  version: SavedBot['version']
  created: boolean
  /** A new bot, not a new version of one. */
  newBot: boolean
}

/**
 * Pushes `bot`: a new version of the user's bot of that name (`GET /api/me/bots`), else a new
 * bot. A `visibility` given for a bot that has another one changes it.
 */
export async function pushBot(
  client: Client,
  bot: LocalBot,
  visibility: Visibility | undefined,
): Promise<Pushed> {
  const { bots } = await client.call('GET', '/me/bots', (v) => parse(MyBotList, v, 'your bots'))
  const mine = bots.find((b) => b.bot.name === bot.name)?.bot
  if (mine === undefined) {
    const saved = await client.call('POST', '/bots', (v) => parse(SavedBot, v, 'the bot'), {
      body: { name: bot.name, source: bot.source, visibility: visibility ?? 'public' },
    })
    return { ...saved, created: true, newBot: true }
  }
  const saved = await client.call(
    'POST',
    `/bots/${encodeURIComponent(mine.id)}/versions`,
    (v) => parse(SavedBotVersion, v, 'the version'),
    { body: { source: bot.source } },
  )
  let shown = saved.bot
  if (visibility !== undefined && visibility !== shown.visibility) {
    shown = (
      await client.call(
        'PATCH',
        `/bots/${encodeURIComponent(mine.id)}`,
        (v) => parse(UpdatedBot, v, 'the bot'),
        { body: { visibility } },
      )
    ).bot
  }
  return { bot: shown, version: saved.version, created: saved.created, newBot: false }
}

/** The `--visibility` flag, checked. */
function visibilityFlag(flags: RemoteArgs['flags']): Visibility | undefined {
  const value = flagValue(flags, 'visibility')
  if (value === undefined) return undefined
  if (!(VISIBILITIES as readonly string[]).includes(value)) {
    throw new RemoteError('--visibility is public, unlisted, or private')
  }
  return value as Visibility
}

/** Prints what a push did, and the bot's page. */
function reportPush(client: Client, pushed: Pushed, io: Io): void {
  const { bot, version } = pushed
  const what = pushed.newBot
    ? 'made'
    : pushed.created
      ? 'new version of'
      : 'no change (same bytes as the latest version) to'
  io.out(`${what} ${bot.name} v${version.version} (${bot.visibility})`)
  io.out(`bot ${bot.id}, version ${version.id}`)
  io.out(`${client.server}/bots/${bot.id}`)
}

/** `asmbots push <bot.asm> [--name <n>] [--visibility <v>]` */
async function push({ args, flags }: RemoteArgs, io: Io): Promise<number> {
  const [file] = args
  if (file === undefined) throw new RemoteError('push needs a bot file: asmbots push <bot.asm>')
  const client = clientOf(flags, io)
  const bot = localBot(file, flagValue(flags, 'name'), io)
  reportPush(client, await pushBot(client, bot, visibilityFlag(flags)), io)
  return 0
}

/** `asmbots submit <hill> <bot.asm> [--wait]`: pushes the bot, then submits that version. */
async function submit({ args, flags }: RemoteArgs, io: Io): Promise<number> {
  const [hill, file] = args
  if (hill === undefined || file === undefined) {
    throw new RemoteError('submit needs a hill and a bot file: asmbots submit <hill> <bot.asm>')
  }
  const client = clientOf(flags, io)
  const bot = localBot(file, flagValue(flags, 'name'), io)
  const pushed = await pushBot(client, bot, visibilityFlag(flags))
  reportPush(client, pushed, io)
  const slug = encodeURIComponent(hill)
  const { submissionId } = await client.call(
    'POST',
    `/hills/${slug}/submit`,
    (v) => parse(HillSubmitted, v, 'the submission'),
    { body: { botVersionId: pushed.version.id } },
  )
  const page = `${client.server}/hills/${slug}?submission=${encodeURIComponent(submissionId)}`
  io.out(`submitted ${bot.name} v${pushed.version.version} to ${hill}: submission ${submissionId}`)
  io.out(page)
  if (flags.wait !== true) return 0
  return waitFor(client, hill, submissionId, pushed.version.id, io)
}

/**
 * `submit --wait`: asks after the submission every 2 s, for 5 minutes at most, until it ends,
 * then prints how it did: its rank and score, how far it moved, and its rating.
 */
async function waitFor(
  client: Client,
  hill: string,
  id: string,
  versionId: string,
  io: Io,
): Promise<number> {
  const slug = encodeURIComponent(hill)
  let said = ''
  for (let tries = 0; tries < POLL_TRIES; tries++) {
    const detail = await client.call(
      'GET',
      `/hills/${slug}/submissions/${encodeURIComponent(id)}`,
      (v) => parse(SubmissionDetail, v, 'the submission'),
      { auth: false },
    )
    const { submission, progress } = detail
    if (submission.status === 'finished') return reportResult(client, hill, detail, versionId, io)
    if (submission.status === 'failed' || submission.status === 'cancelled') {
      throw new RemoteError(`the submission ${submission.status}`)
    }
    const now = progress ? `fighting ${progress.done} of ${progress.of}` : submission.status
    if (now !== said) io.out(now)
    said = now
    await io.sleep(POLL_MS)
  }
  throw new RemoteError(`still going after 5 minutes: watch it at ${client.server}/hills/${slug}`)
}

/** Prints a finished submission: on the hill (rank, score, move, rating), or turned away. */
async function reportResult(
  client: Client,
  hill: string,
  detail: SubmissionDetail,
  versionId: string,
  io: Io,
): Promise<number> {
  const { submission, events } = detail
  const score = submission.score === null ? '?' : String(submission.score)
  if (submission.rank === null) {
    const needed = submission.needed === null ? '' : `, needed ${submission.needed}`
    io.out(`did not stay on ${hill}: scored ${score}${needed}`)
    return 0
  }
  const entered = events.find(
    (e) => e.event.kind === 'entered' && e.event.botVersionId === versionId,
  )
  const delta = entered?.event.delta ?? null
  const moved =
    delta === null
      ? 'new on the hill'
      : delta === 0
        ? 'same place'
        : delta > 0
          ? `up ${delta}`
          : `down ${-delta}`
  io.out(`entered ${hill} at rank ${submission.rank} (${moved}), score ${score}`)
  const standing = await client
    .call('GET', `/hills/${encodeURIComponent(hill)}`, (v) => parse(HillDetail, v, 'the hill'), {
      auth: false,
      fresh: true,
    })
    .then(({ standings }) => standings.find((s) => s.entry.botVersionId === versionId))
    .catch(() => undefined)
  if (standing !== undefined) {
    const rd = standing.rd === null ? '' : ` ± ${Math.round(standing.rd)}`
    io.out(`rating ${Math.round(standing.entry.rating)}${rd}`)
  }
  return 0
}

/** `asmbots hills`: every hill, its entrants, and its king. */
async function hills({ flags }: RemoteArgs, io: Io): Promise<number> {
  const client = clientOf(flags, io)
  const list = await client.call('GET', '/hills', (v) => parse(HillList, v, 'the hills'), {
    auth: false,
  })
  const rows = list.hills.map(({ hill, entrants, king }) => [
    hill.slug,
    hill.name,
    hill.scoring,
    `${entrants}/${hill.size}`,
    king === null ? '-' : `${king.bot.name} v${king.bot.version} by ${king.bot.owner}`,
  ])
  const head = ['slug', 'name', 'scoring', 'entrants', 'king']
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)))
  for (const row of [head, ...rows]) {
    io.out(
      row
        .map((cell, i) => cell.padEnd(widths[i] ?? 0))
        .join('  ')
        .trimEnd(),
    )
  }
  return 0
}

/**
 * Runs `command` when it is one of `REMOTE_COMMANDS`, with `argv` the words after it: its exit
 * code, 0 or 1 (an error printed as `error: ...`). Null for any other command.
 */
export async function runRemote(
  command: string,
  argv: readonly string[],
  io: Io = defaultIo(),
): Promise<number | null> {
  if (!(REMOTE_COMMANDS as readonly string[]).includes(command)) return null
  const parsed = parseRemoteArgs(argv)
  try {
    switch (command) {
      case 'login':
        return await login(parsed, io)
      case 'logout':
        return logout(io)
      case 'whoami':
        return await whoami(parsed, io)
      case 'push':
        return await push(parsed, io)
      case 'submit':
        return await submit(parsed, io)
      default:
        return await hills(parsed, io)
    }
  } catch (err) {
    io.err(`error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}

/** The help for the network commands. */
export const REMOTE_HELP: Readonly<Record<(typeof REMOTE_COMMANDS)[number], string>> = {
  login: `login [--token <t>] [--server <url>]
  Sign in with a personal API token (make one on the site's settings page). Without --token,
  reads it from stdin. Checks it with the server, then saves it to ~/.config/asmbots/config.json.`,
  logout: `logout
  Forget the saved token. Revoke it on the settings page to end it everywhere.`,
  whoami: `whoami [--server <url>]
  Print who the token signs in, and on which server.`,
  push: `push <bot.asm> [--name <n>] [--visibility public|unlisted|private] [--server <url>]
  Assemble the bot here, then save it to your account: a new version of your bot of that name,
  else a new bot (public unless --visibility says otherwise). The name is --name, else the
  source's %name, else the file name. Prints the bot's id, its version, and its page.`,
  submit: `submit <hill> <bot.asm> [--wait] [--name <n>] [--visibility <v>] [--server <url>]
  Push the bot, then submit that version to the hill. With --wait, follow the submission (every
  2 s, 5 minutes at most) and print its rank, score, and rating.`,
  hills: `hills [--server <url>]
  List the hills: slug, name, scoring, entrants, and king.`,
}

/**
 * Where the network commands find the server and the token: `--server`, else `ASMBOTS_SERVER`,
 * else the saved server, else https://asmbots.io; `ASMBOTS_TOKEN`, else the saved token.
 */
export const REMOTE_ENV_HELP = `Server and token:
  --server <url>, else ASMBOTS_SERVER, else the saved server, else ${DEFAULT_SERVER}
  ASMBOTS_TOKEN, else the token saved by asmbots login

Exit codes:
  0  Success
  1  Error (the server's message is printed; 401: run asmbots login)`
