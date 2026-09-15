import { createMocks } from 'node-mocks-http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import handler from '../../../../../../../pages/api/platform/projects/[ref]/config/supavisor'
import { mswServer } from '@/tests/lib/msw'

vi.mock('@/lib/constants', () => ({
  IS_PLATFORM: false,
  API_URL: 'https://api.example.com',
}))

const fetchMock = vi.fn()

const TENANT = {
  id: '0f1d6e0e-6c2a-4f0b-9a9a-6d5f2b8a1c33',
  external_id: 'dev_tenant',
  db_host: 'supabase-db',
  db_port: 5432,
  db_database: 'postgres',
  default_pool_size: 20,
  default_max_clients: 200,
  inserted_at: '2026-01-01T00:00:00',
  users: [{ db_user: 'postgres', is_manager: true, mode_type: 'transaction', pool_size: 20 }],
}

const ok = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as Response

describe('/api/platform/projects/[ref]/config/supavisor', () => {
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
    it.each(['POST', 'PATCH', 'DELETE'] as const)('should return 405 for %s', async (method) => {
      const { req, res } = createMocks({ method, query: { ref: 'default' } })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(405)
      expect(JSON.parse(res._getData())).toEqual({
        data: null,
        error: { message: `Method ${method} Not Allowed` },
      })
      expect(res.getHeader('Allow')).toEqual(['GET'])
    })
  })

  describe('GET', () => {
    it('answers with the one pooler this stack runs', async () => {
      const { req, res } = createMocks({ method: 'GET', query: { ref: 'default' } })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(200)
      expect(JSON.parse(res._getData())).toEqual([
        {
          connection_string:
            'postgresql://postgres.dev_tenant:[YOUR-PASSWORD]@db.example.test:6543/postgres',
          connectionString:
            'postgresql://postgres.dev_tenant:[YOUR-PASSWORD]@db.example.test:6543/postgres',
          database_type: 'PRIMARY',
          db_host: 'db.example.test',
          db_name: 'postgres',
          db_port: 6543,
          db_user: 'postgres.dev_tenant',
          default_pool_size: 20,
          identifier: 'default',
          is_using_scram_auth: true,
          max_client_conn: 200,
          pool_mode: 'transaction',
        },
      ])
    })

    it('answers 502 when the pooler cannot be reached', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'))
      const { req, res } = createMocks({ method: 'GET', query: { ref: 'default' } })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(502)
      expect(JSON.parse(res._getData()).error.message).toContain('fetch failed')
    })
  })
})
