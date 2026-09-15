import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ServiceUnavailableError } from './errors'
import { adminFetch } from './http'

const URL = 'http://supabase-supavisor:4000/api/tenants/dev_tenant'

const fetchMock = vi.fn()

/** A `Response` as the helper reads one: `ok`, `status`, and a body it takes as text. */
const answer = (status: number, body: string) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  }) as unknown as Response

/** The error a call rejected with. A call that resolves fails the test rather than the assertion. */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    if (error instanceof Error) return error
    throw new Error(`Rejected with something that is not an Error: ${String(error)}`)
  }
  throw new Error('Expected the call to reject')
}

describe('api/self-hosted/service-config/http', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('the request it sends', () => {
    it('carries the token as a bearer and asks for JSON', async () => {
      fetchMock.mockResolvedValue(answer(200, '{}'))

      await adminFetch(URL, { method: 'GET', token: 'a-token' })

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(URL)
      expect(init.method).toBe('GET')
      expect(init.headers).toMatchObject({
        Authorization: 'Bearer a-token',
        'Content-Type': 'application/json',
      })
    })

    it('keeps the caller’s body and extra headers', async () => {
      fetchMock.mockResolvedValue(answer(200, '{}'))

      await adminFetch(URL, {
        method: 'PUT',
        token: 'a-token',
        body: '{"tenant":{}}',
        headers: { Accept: 'application/json' },
      })

      const [, init] = fetchMock.mock.calls[0]
      expect(init.body).toBe('{"tenant":{}}')
      expect(init.headers).toMatchObject({ Accept: 'application/json' })
    })

    it('gives the service a deadline rather than hanging the page', async () => {
      fetchMock.mockResolvedValue(answer(200, '{}'))

      await adminFetch(URL, { method: 'GET', token: 'a-token' })

      const [, init] = fetchMock.mock.calls[0]
      expect(init.signal).toBeInstanceOf(AbortSignal)
      expect(init.signal.aborted).toBe(false)
    })
  })

  describe('what it answers with', () => {
    it('parses the JSON body', async () => {
      fetchMock.mockResolvedValue(answer(200, '{"data":{"external_id":"dev_tenant"}}'))

      await expect(adminFetch(URL, { method: 'GET', token: 't' })).resolves.toEqual({
        data: { external_id: 'dev_tenant' },
      })
    })

    it('reads an empty body as no body, so a 204 is still a success', async () => {
      fetchMock.mockResolvedValue(answer(204, ''))

      await expect(adminFetch(URL, { method: 'DELETE', token: 't' })).resolves.toBeUndefined()
    })

    it('treats a 201 as success — the admin API answers a create that way', async () => {
      fetchMock.mockResolvedValue(answer(201, '{"data":{}}'))

      await expect(adminFetch(URL, { method: 'PUT', token: 't' })).resolves.toEqual({ data: {} })
    })
  })

  describe('when the service cannot be reached', () => {
    it('turns a refused connection into ServiceUnavailableError', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'))

      await expect(adminFetch(URL, { method: 'GET', token: 't' })).rejects.toThrow(
        ServiceUnavailableError
      )
      await expect(adminFetch(URL, { method: 'GET', token: 't' })).rejects.toThrow(/fetch failed/)
    })

    it('turns the timeout abort into ServiceUnavailableError', async () => {
      fetchMock.mockRejectedValue(new DOMException('The operation was aborted.', 'TimeoutError'))

      const error = await rejection(adminFetch(URL, { method: 'GET', token: 't' }))

      expect(error).toBeInstanceOf(ServiceUnavailableError)
      expect(error.message).toContain(URL)
      expect(error.message).toContain('aborted')
    })

    it('names the status and the service’s own words on a non-2xx', async () => {
      fetchMock.mockResolvedValue(answer(422, '{"errors":{"users":["can\'t be blank"]}}'))

      const error = await rejection(adminFetch(URL, { method: 'PUT', token: 't' }))

      expect(error).toBeInstanceOf(ServiceUnavailableError)
      expect(error.message).toContain('422')
      expect(error.message).toContain("can't be blank")
    })

    it('reports a 403 rather than pretending the secret matched', async () => {
      fetchMock.mockResolvedValue(answer(403, ''))

      await expect(adminFetch(URL, { method: 'GET', token: 't' })).rejects.toThrow(/403/)
    })

    it('truncates a long error body to 300 characters', async () => {
      fetchMock.mockResolvedValue(answer(500, 'x'.repeat(5000)))

      const error = await rejection(adminFetch(URL, { method: 'GET', token: 't' }))

      expect(error.message).toContain(`${'x'.repeat(300)}…`)
      expect(error.message).not.toContain('x'.repeat(301))
    })

    it('does not pass a body that is not JSON off as a result', async () => {
      fetchMock.mockResolvedValue(answer(200, '<html>502 Bad Gateway</html>'))

      await expect(adminFetch(URL, { method: 'GET', token: 't' })).rejects.toThrow(
        ServiceUnavailableError
      )
    })
  })
})
