/**
 * GitHub sign-in (ARCHITECTURE §7, Auth), mounted at `/api/auth`:
 * - `GET /github?returnTo=/path`: a state in a 10-minute cookie, then off to GitHub.
 * - `GET /github/callback`: the code for a token, the token for the GitHub user and their primary
 *   email, the user made or refreshed by `github_id`, a session, then back to `returnTo` or
 *   `/?signed-in=1`.
 * - `POST /logout`: ends the session; 204 either way.
 * The OAuth app's registered callback URL is the redirect URI, so dev and production differ only
 * in which app's id and secret they hold.
 *
 * With `fakeAuth` (`DEV_FAKE_AUTH=1` on localhost) GitHub is never called: `/github` comes straight
 * back to the callback, which signs in the test user `e2e-tester`, or the login `?as=` names.
 */
import { GitHub, generateState, OAuth2RequestError } from 'arctic'
import { type Context, Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import {
  type GithubProfile,
  isHandleTaken,
  updateGithubUser,
  upsertGithubUser,
} from '../db/queries'
import type { AppEnv } from '../env'
import { errorResponse, log } from '../middleware'
import { handleCandidates } from './handle'
import {
  authConfigured,
  cookieOptions,
  endSession,
  fakeAuth,
  sessionKey,
  startSession,
} from './session'

const STATE_COOKIE = 'oauth_state'
const RETURN_COOKIE = 'oauth_return_to'
/** The sign-in cookies live only as long as a trip to GitHub and back, and only under here. */
const AUTH_PATH = '/api/auth'
const STATE_TTL_SECONDS = 10 * 60
const SCOPES = ['read:user', 'user:email']
const SIGNED_IN = '/?signed-in=1'

/** The test user of `fakeAuth`, and the logins `?as=` may name instead. */
const FAKE_LOGIN = 'e2e-tester'
const FAKE_AS = /^[a-z0-9-]{1,39}$/

/** A path on this site: one leading slash, not `//host` or `/\host`, no whitespace. */
const LOCAL_PATH = /^\/(?![/\\])\S{0,511}$/

function github(c: Context<AppEnv>): GitHub {
  return new GitHub(c.env.GITHUB_CLIENT_ID ?? '', c.env.GITHUB_CLIENT_SECRET ?? '', null)
}

async function githubApi(path: string, token: string): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'asmbots',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
}

/** The GitHub account behind `token`: its id, login, avatar, and primary verified email. */
async function fetchGithubAccount(token: string): Promise<GithubProfile & { login: string }> {
  const res = await githubApi('/user', token)
  if (!res.ok) throw new Error(`GitHub /user answered ${res.status}`)
  const user = (await res.json()) as { id?: unknown; login?: unknown; avatar_url?: unknown }
  if (typeof user.id !== 'number' || typeof user.login !== 'string') {
    throw new Error('GitHub /user has no id or login')
  }
  return {
    githubId: user.id,
    login: user.login,
    avatarUrl: typeof user.avatar_url === 'string' ? user.avatar_url : null,
    email: await fetchPrimaryEmail(token),
  }
}

/** Null when the account has no verified primary email or GitHub will not say. */
async function fetchPrimaryEmail(token: string): Promise<string | null> {
  const res = await githubApi('/user/emails', token)
  if (!res.ok) return null
  const emails = (await res.json()) as unknown
  if (!Array.isArray(emails)) return null
  const primary = emails.find((e) => e?.primary === true && e?.verified === true)
  return typeof primary?.email === 'string' ? primary.email : null
}

/** The account `fakeAuth` signs in for `login`: an id of its own, above any real GitHub id. */
function fakeAccount(login: string): GithubProfile & { login: string } {
  let hash = 0x811c9dc5
  for (const ch of login) hash = Math.imul(hash ^ (ch.codePointAt(0) ?? 0), 0x01000193) >>> 0
  return { githubId: 2 ** 40 + hash, login, avatarUrl: null, email: null }
}

/** The user for a GitHub account, made on its first sign-in. */
async function signInUser(db: D1Database, account: GithubProfile & { login: string }) {
  const known = await updateGithubUser(db, account)
  if (known) return known
  for (const handle of handleCandidates(account.login)) {
    if (await isHandleTaken(db, handle)) continue
    return upsertGithubUser(db, { ...account, id: crypto.randomUUID(), handle })
  }
  throw new Error(`no free handle for GitHub login ${account.login}`)
}

/** Signs `account` in: its user, a new session in place of any the browser had, then `back`. */
async function finishSignIn(
  c: Context<AppEnv>,
  account: GithubProfile & { login: string },
  back: string,
): Promise<Response> {
  const user = await signInUser(c.env.DB, account)
  const old = c.get('session')
  if (old) await c.env.KV.delete(sessionKey(old.id))
  await startSession(c, user.id)
  return c.redirect(back, 302)
}

export const auth = new Hono<AppEnv>()
  .get('/github', (c) => {
    if (!authConfigured(c)) return errorResponse(c, 'internal', 'sign-in is not configured')
    const state = generateState()
    setCookie(c, STATE_COOKIE, state, cookieOptions(STATE_TTL_SECONDS, AUTH_PATH))
    const returnTo = c.req.query('returnTo')
    if (returnTo && LOCAL_PATH.test(returnTo)) {
      setCookie(c, RETURN_COOKIE, returnTo, cookieOptions(STATE_TTL_SECONDS, AUTH_PATH))
    } else {
      deleteCookie(c, RETURN_COOKIE, { path: AUTH_PATH, secure: true })
    }
    if (fakeAuth(c)) {
      const as = c.req.query('as')
      const code = as !== undefined && FAKE_AS.test(as) ? as : FAKE_LOGIN
      const query = new URLSearchParams({ code, state })
      return c.redirect(`${AUTH_PATH}/github/callback?${query}`, 302)
    }
    return c.redirect(github(c).createAuthorizationURL(state, SCOPES).toString(), 302)
  })
  .get('/github/callback', async (c) => {
    if (!authConfigured(c)) return errorResponse(c, 'internal', 'sign-in is not configured')
    const expected = getCookie(c, STATE_COOKIE)
    const returnTo = getCookie(c, RETURN_COOKIE)
    deleteCookie(c, STATE_COOKIE, { path: AUTH_PATH, secure: true })
    deleteCookie(c, RETURN_COOKIE, { path: AUTH_PATH, secure: true })
    const back = returnTo && LOCAL_PATH.test(returnTo) ? returnTo : SIGNED_IN
    // The user said no on GitHub: back where they were, still signed out.
    if (c.req.query('error')) return c.redirect(back === SIGNED_IN ? '/' : back, 302)
    const { code, state } = c.req.query()
    if (!code || !state || !expected || state !== expected) {
      return errorResponse(c, 'bad_request', 'the sign-in expired or did not match: try again')
    }
    if (fakeAuth(c)) {
      return finishSignIn(c, fakeAccount(FAKE_AS.test(code) ? code : FAKE_LOGIN), back)
    }
    let token: string
    try {
      token = (await github(c).validateAuthorizationCode(code)).accessToken()
    } catch (err) {
      if (!(err instanceof OAuth2RequestError)) throw err
      log('warn', 'github refused the code', { requestId: c.get('requestId'), code: err.code })
      return errorResponse(c, 'bad_request', `github refused the sign-in (${err.code}): try again`)
    }
    return finishSignIn(c, await fetchGithubAccount(token), back)
  })
  .post('/logout', async (c) => {
    await endSession(c)
    return c.body(null, 204)
  })
