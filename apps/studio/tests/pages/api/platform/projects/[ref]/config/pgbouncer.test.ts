import { createMocks } from 'node-mocks-http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import handler from '../../../../../../../pages/api/platform/projects/[ref]/config/pgbouncer'
import { mswServer } from '@/tests/lib/msw'

vi.mock('@/lib/constants', () => ({
  IS_PLATFORM: false,
  API_URL: 'https://api.example.com',
}))

const fetchMock = vi.fn()

/** The tenant as Supavisor's `TenantView` serialises it, wrapped the way the controller answers. */
const TENANT = {
  id: '0f1d6e0e-6c2a-4f0b-9a9a-6d5f2b8a1c33',
  external_id: 'dev_tenant',
  db_host: 'supabase-db',
  db_port: 5432,
  db_database: 'postgres',
  default_parameter_status: { server_version: '15.8' },
  enforce_ssl: false,
  require_user: false,
  default_pool_size: 20,
  default_max_clients: 200,
  allow_list: ['0.0.0.0/0', '::/0'],
  inserted_at: '2026-01-01T00:00:00',
  updated_at: '2026-01-02T00:00:00',
  users: [
    {
      db_user: 'postgres',
      db_user_alias: 'postgres',
      db_password: 'the-password-supavisor-holds',
      is_manager: true,
      mode_type: 'transaction',
      pool_size: 20,
      pool_checkout_timeout: 60_000,
      max_clients: 200,
    },
  ],
}

const ok = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as Response

describe('/api/platform/projects/[ref]/config/pgbouncer', () => {
  beforeEach(() => {
    // The handler talks to Supavisor through a stubbed `fetch`; MSW would only report the call it
    // never sees as unhandled.
    mswServer.close()
    fetchMock.mockReset()
    fetchMock.mockImplementation(() => Promise.resolve(ok({ data: TENANT })))
    vi.stubGlobal('fetch', fetchMock)
    vi.unstubAllEnvs()
    vi.stubEnv('SUPAVISOR_URL', undefined)
    vi.stubEnv('POOLER_TENANT_ID', undefined)
    vi.stubEnv('POOLER_PROXY_PORT_TRANSACTION', undefined)
    vi.stubEnv('SUPABASE_PUBLIC_URL', 'http://db.example.test:8000')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  describe('Method handling', () => {
    it.each(['POST', 'DELETE', 'PUT'] as const)('should return 405 for %s', async (method) => {
      const { req, res } = createMocks({ method, query: { ref: 'default' } })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(405)
      expect(JSON.parse(res._getData())).toEqual({
        data: null,
        error: { message: `Method ${method} Not Allowed` },
      })
      expect(res.getHeader('Allow')).toEqual(['GET', 'PATCH'])
    })
  })

  describe('GET', () => {
    it('answers with the pooling configuration Supavisor is running on', async () => {
      const { req, res } = createMocks({ method: 'GET', query: { ref: 'default' } })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(200)
      expect(JSON.parse(res._getData())).toEqual({
        connection_string:
          'postgresql://postgres.dev_tenant:[YOUR-PASSWORD]@db.example.test:6543/postgres',
        db_dns_name: 'db.example.test',
        db_host: 'db.example.test',
        db_name: 'postgres',
        db_port: 6543,
        db_user: 'postgres.dev_tenant',
        default_pool_size: 20,
        ignore_startup_parameters: 'options,extra_float_digits',
        inserted_at: '2026-01-01T00:00:00',
        max_client_conn: 200,
        pgbouncer_enabled: true,
        pool_mode: 'transaction',
        ssl_enforced: false,
      })
    })

    it('writes nothing', async () => {
      const { req, res } = createMocks({ method: 'GET', query: { ref: 'default' } })

      await handler(req, res)

      expect(fetchMock.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true)
    })

    it('answers 502 when the pooler cannot be reached', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'))
      const { req, res } = createMocks({ method: 'GET', query: { ref: 'default' } })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(502)
      expect(JSON.parse(res._getData()).error.message).toContain('fetch failed')
    })
  })

  describe('PATCH', () => {
    it('writes the pool size and answers with the configuration as it now stands', async () => {
      const { req, res } = createMocks({
        method: 'PATCH',
        query: { ref: 'default' },
        body: { default_pool_size: 30, ignore_startup_parameters: 'options,extra_float_digits' },
      })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(200)
      expect(JSON.parse(res._getData())).toMatchObject({ pgbouncer_enabled: true })

      const put = fetchMock.mock.calls.find(([, init]) => init.method === 'PUT')
      expect(put).toBeDefined()
      expect(JSON.parse(put![1].body).tenant).toMatchObject({ default_pool_size: 30 })
    })

    it('answers 400 for a pool size the pooler would refuse', async () => {
      const { req, res } = createMocks({
        method: 'PATCH',
        query: { ref: 'default' },
        body: { default_pool_size: 0 },
      })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(400)
      expect(JSON.parse(res._getData()).error.message).toContain('default_pool_size')
      expect(fetchMock.mock.calls.some(([, init]) => init.method === 'PUT')).toBe(false)
    })

    it('answers 400 for a body that is not an object', async () => {
      const { req, res } = createMocks({ method: 'PATCH', query: { ref: 'default' }, body: [] })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(400)
      expect(JSON.parse(res._getData()).error.message).toContain('object')
    })

    it('answers 502 when the pooler refuses the changeset', async () => {
      fetchMock.mockImplementation((_url: string, init: { method: string }) =>
        init.method === 'PUT'
          ? Promise.resolve({
              ok: false,
              status: 422,
              text: () => Promise.resolve('{"errors":{"users":["can\'t be blank"]}}'),
            } as unknown as Response)
          : Promise.resolve(ok({ data: TENANT }))
      )
      const { req, res } = createMocks({
        method: 'PATCH',
        query: { ref: 'default' },
        body: { default_pool_size: 30 },
      })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(502)
      expect(JSON.parse(res._getData()).error.message).toContain('422')
    })

    it('answers 502 when the pooler cannot be reached', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'))
      const { req, res } = createMocks({
        method: 'PATCH',
        query: { ref: 'default' },
        body: { default_pool_size: 30 },
      })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(502)
    })
  })
})
