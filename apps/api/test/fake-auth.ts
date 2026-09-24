/**
 * Requests to the Worker's own module as a signed-in test user: `DEV_FAKE_AUTH` is on, so a
 * sign-in needs no stub of GitHub. A `Jar` carries each user's cookies.
 */
import { env } from 'cloudflare:workers'
import { Me, parse } from '@asmbots/protocol'
import { expect } from 'vitest'
import type { Env } from '../src/env'
import worker from '../src/index'
import type { Jar } from './jar'

export const LOCAL = 'http://localhost:8787'
export const FAKE: Env = { ...env, DEV_FAKE_AUTH: '1' }

const CTX = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext

interface Send {
  method?: string
  body?: unknown
  site?: string
  vars?: Env
}

export async function send(
  jar: Jar,
  path: string,
  { method = 'GET', body, site = LOCAL, vars = FAKE }: Send = {},
): Promise<Response> {
  const headers = new Headers({ Cookie: jar.header() })
  if (method !== 'GET') headers.set('Origin', site)
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  const init = { method, headers, redirect: 'manual' as const }
  const request = new Request(`${site}${path}`, {
    ...init,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })
  const res = await worker.fetch(request, vars, CTX)
  jar.take(res)
  return res
}

/** Signs in the test user `as` through the fake sign-in; returns the callback's redirect. */
export async function signIn(jar: Jar, as: string, returnTo = '/editor'): Promise<Response> {
  const start = await send(jar, `/api/auth/github?as=${as}&returnTo=${returnTo}`)
  expect(start.status).toBe(302)
  const to = start.headers.get('Location') ?? ''
  expect(to).toMatch(/^\/api\/auth\/github\/callback\?/)
  return send(jar, to)
}

export async function me(jar: Jar): Promise<Me> {
  const res = await send(jar, '/api/me')
  expect(res.status).toBe(200)
  return parse(Me, await res.json(), 'me')
}

export async function errorOf(
  res: Response,
): Promise<{ status: number; code: string; message: string }> {
  const { error } = (await res.json()) as { error: { code: string; message: string } }
  return { status: res.status, code: error.code, message: error.message }
}

/** A bot that assembles: it jumps to itself. */
export const SPIN = '%name "Spin"\n%author "Tester"\n%strategy "Jump to itself"\nstart: jmp $\n'
/** Another that assembles, to other bytes. */
export const HALT = '%name "Halt"\nstart: hlt ; lint: allow hlt-in-code\n'
