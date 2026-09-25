/**
 * The hills' reads and the API's 30 s cache (`apps/api/src/edge-cache.ts`): a first read may come
 * from it; a read again asks past it (`Cache-Control: no-cache`), so a board the page knows has
 * changed shows as it is.
 */
import { describe, expect, it } from 'bun:test'
import { HttpResponse, http } from 'msw'
import { apiGet } from '../src/api/client'
import { hillQuery, hillsQuery } from '../src/api/queries'
import { testQueryClient, useApiServer } from './api-server'
import { HILLS, MAIN_DETAIL } from './fixtures/api'

/** Each request's `Cache-Control`, by path. */
const asked: Record<string, (string | null)[]> = {}

const record = (path: string, body: object) =>
  http.get(`*/api${path}`, ({ request }) => {
    const seen = asked[path] ?? []
    seen.push(request.headers.get('Cache-Control'))
    asked[path] = seen
    return HttpResponse.json(body)
  })

useApiServer(record('/hills', HILLS), record('/hills/main', MAIN_DETAIL), record('/any', {}))

describe('the hills and the API cache', () => {
  it('reads a hill from the cache first, and past it each time after', async () => {
    const client = testQueryClient()
    await client.query(hillQuery('main'))
    await client.query(hillQuery('main'))
    await client.invalidateQueries({ queryKey: ['hills', 'main'] })
    await client.query(hillQuery('main'))
    expect(asked['/hills/main']).toEqual([null, 'no-cache', 'no-cache'])
  })

  it('reads the hills list the same way', async () => {
    const client = testQueryClient()
    await client.query(hillsQuery())
    await client.query(hillsQuery())
    expect(asked['/hills']).toEqual([null, 'no-cache'])
  })

  it('leaves the cache alone unless asked', async () => {
    await apiGet('/any', (v) => v)
    await apiGet('/any', (v) => v, undefined, true)
    expect(asked['/any']).toEqual([null, 'no-cache'])
  })
})
