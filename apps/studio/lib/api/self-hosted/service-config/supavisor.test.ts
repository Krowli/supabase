import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AUTH_JWT_SECRET, POSTGRES_PASSWORD } from '../constants'
import { ServiceConfigValidationError, ServiceUnavailableError } from './errors'
import { getPoolerConfig, getSupavisorConfig, updatePoolerConfig } from './supavisor'

const fetchMock = vi.fn()

/** The tenant as Supavisor's `TenantView` serialises it, wrapped the way the controller answers. */
const tenant = (overrides: Record<string, unknown> = {}) => ({
  id: '0f1d6e0e-6c2a-4f0b-9a9a-6d5f2b8a1c33',
  external_id: 'dev_tenant',
  db_host: 'supabase-db',
  db_port: 5432,
  db_database: 'postgres',
  default_parameter_status: { server_version: '15.8' },
  ip_version: 'auto',
  upstream_ssl: false,
  upstream_verify: null,
  enforce_ssl: false,
  require_user: false,
  auth_query: 'SELECT rolname, rolpassword FROM pg_authid WHERE rolname=$1;',
  default_pool_size: 20,
  sni_hostname: null,
  default_max_clients: 200,
  client_idle_timeout: 0,
  client_heartbeat_interval: 60,
  allow_list: ['0.0.0.0/0', '::/0'],
  availability_zone: null,
  feature_flags: {},
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
  ...overrides,
})

const ok = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as Response

/** Supavisor answers every call with this tenant, whichever method asked. */
const supavisorHolds = (overrides: Record<string, unknown> = {}) => {
  const current = tenant(overrides)
  fetchMock.mockImplementation(() => Promise.resolve(ok({ data: current })))
  return current
}

const callsTo = (method: string) =>
  fetchMock.mock.calls.filter(([, init]) => init.method === method)

/** The `tenant` object of the one PUT that was sent. */
const putBody = (): Record<string, unknown> => {
  const [, init] = callsTo('PUT')[0]
  return JSON.parse(init.body).tenant
}

const bearerOf = (call: unknown[]): string => {
  const [, init] = call as [string, { headers: Record<string, string> }]
  return init.headers.Authorization.replace('Bearer ', '')
}

describe('api/self-hosted/service-config/supavisor', () => {
  beforeEach(() => {
    fetchMock.mockReset()
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

  describe('the request it makes', () => {
    it('asks Supavisor for the one tenant this stack runs', async () => {
      supavisorHolds()

      await getPoolerConfig()

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('http://supabase-supavisor:4000/api/tenants/dev_tenant')
      expect(init.method).toBe('GET')
    })

    it('takes the admin URL and tenant id from the environment', async () => {
      vi.stubEnv('SUPAVISOR_URL', 'http://pooler.internal:5000')
      vi.stubEnv('POOLER_TENANT_ID', 'my_tenant')
      supavisorHolds()

      await getPoolerConfig()

      expect(fetchMock.mock.calls[0][0]).toBe('http://pooler.internal:5000/api/tenants/my_tenant')
    })

    it('signs the bearer token with the secret Supavisor verifies against', async () => {
      supavisorHolds()

      await getPoolerConfig()

      const [header, claims, signature] = bearerOf(fetchMock.mock.calls[0]).split('.')
      expect(signature).toBe(
        createHmac('sha256', AUTH_JWT_SECRET).update(`${header}.${claims}`).digest('base64url')
      )
      expect(JSON.parse(Buffer.from(claims, 'base64url').toString()).exp).toBeGreaterThan(
        Math.floor(Date.now() / 1000)
      )
    })
  })

  describe('getPoolerConfig', () => {
    it('maps the tenant onto the pooling configuration the UI reads', async () => {
      supavisorHolds()

      await expect(getPoolerConfig()).resolves.toEqual({
        connection_string:
          'postgresql://postgres.dev_tenant:[YOUR-PASSWORD]@db.example.test:6543/postgres',
        db_dns_name: 'db.example.test',
        db_host: 'supabase-db',
        db_name: 'postgres',
        db_port: 5432,
        db_user: 'postgres',
        default_pool_size: 20,
        ignore_startup_parameters: 'options,extra_float_digits',
        inserted_at: '2026-01-01T00:00:00',
        max_client_conn: 200,
        pgbouncer_enabled: true,
        pool_mode: 'transaction',
        ssl_enforced: false,
      })
    })

    it('reads the pool mode off the manager user', async () => {
      supavisorHolds({
        users: [
          { db_user: 'other', is_manager: false, mode_type: 'transaction', pool_size: 5 },
          { db_user: 'postgres', is_manager: true, mode_type: 'session', pool_size: 20 },
        ],
      })

      await expect(getPoolerConfig()).resolves.toMatchObject({ pool_mode: 'session' })
    })

    it('falls back to transaction when the tenant has no users to read a mode from', async () => {
      supavisorHolds({ users: [] })

      await expect(getPoolerConfig()).resolves.toMatchObject({ pool_mode: 'transaction' })
    })

    it('reports enforced SSL as the tenant has it', async () => {
      supavisorHolds({ enforce_ssl: true })

      await expect(getPoolerConfig()).resolves.toMatchObject({ ssl_enforced: true })
    })

    it('answers with the epoch for a tenant that carries no timestamp', async () => {
      supavisorHolds({ inserted_at: null })

      await expect(getPoolerConfig()).resolves.toMatchObject({
        inserted_at: new Date(0).toISOString(),
      })
    })

    it('builds the connection string on the transaction port the environment names', async () => {
      vi.stubEnv('POOLER_PROXY_PORT_TRANSACTION', '7654')
      supavisorHolds()

      await expect(getPoolerConfig()).resolves.toMatchObject({
        connection_string:
          'postgresql://postgres.dev_tenant:[YOUR-PASSWORD]@db.example.test:7654/postgres',
      })
    })

    it('says so rather than answering with an empty configuration when the tenant is missing', async () => {
      fetchMock.mockResolvedValue(ok({ data: null }))

      await expect(getPoolerConfig()).rejects.toThrow(/no tenant/)
    })

    it('lets a service failure through as ServiceUnavailableError', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'))

      await expect(getPoolerConfig()).rejects.toThrow(ServiceUnavailableError)
    })
  })

  describe('getSupavisorConfig', () => {
    it('answers with the one pooler this stack runs', async () => {
      supavisorHolds()

      await expect(getSupavisorConfig()).resolves.toEqual([
        {
          connection_string:
            'postgresql://postgres.dev_tenant:[YOUR-PASSWORD]@db.example.test:6543/postgres',
          connectionString:
            'postgresql://postgres.dev_tenant:[YOUR-PASSWORD]@db.example.test:6543/postgres',
          database_type: 'PRIMARY',
          db_host: 'supabase-db',
          db_name: 'postgres',
          db_port: 5432,
          db_user: 'postgres',
          default_pool_size: 20,
          identifier: 'default',
          is_using_scram_auth: true,
          max_client_conn: 200,
          pool_mode: 'transaction',
        },
      ])
    })

    it('is identified as the project the pooling dialog looks for', async () => {
      supavisorHolds()

      const [config] = await getSupavisorConfig()
      expect(config.identifier).toBe('default')
    })
  })

  describe('updatePoolerConfig', () => {
    it('sends exactly one PUT, after one read', async () => {
      supavisorHolds()

      await updatePoolerConfig({ default_pool_size: 30 })

      expect(callsTo('PUT')).toHaveLength(1)
      expect(callsTo('GET')).toHaveLength(2)
    })

    it('writes the new sizes onto the tenant', async () => {
      supavisorHolds()

      await updatePoolerConfig({ default_pool_size: 30, max_client_conn: 500 })

      expect(putBody()).toMatchObject({ default_pool_size: 30, default_max_clients: 500 })
    })

    it('sends the whole tenant back, because the changeset validates it whole', async () => {
      supavisorHolds()

      await updatePoolerConfig({ default_pool_size: 30 })

      // The seven fields Supavisor's `validate_required` refuses a changeset without.
      expect(putBody()).toMatchObject({
        default_parameter_status: { server_version: '15.8' },
        external_id: 'dev_tenant',
        db_host: 'supabase-db',
        db_port: 5432,
        db_database: 'postgres',
        require_user: false,
        allow_list: ['0.0.0.0/0', '::/0'],
      })
    })

    it('leaves the server’s own columns out of the changeset', async () => {
      supavisorHolds()

      await updatePoolerConfig({ default_pool_size: 30 })

      expect(putBody()).not.toHaveProperty('id')
      expect(putBody()).not.toHaveProperty('inserted_at')
      expect(putBody()).not.toHaveProperty('updated_at')
    })

    it('resupplies every user with the password the changeset requires', async () => {
      supavisorHolds()

      await updatePoolerConfig({ default_pool_size: 30 })

      const users = putBody().users as Record<string, unknown>[]
      expect(users).toHaveLength(1)
      expect(users[0]).toEqual({
        db_user: 'postgres',
        db_user_alias: 'postgres',
        db_password: 'the-password-supavisor-holds',
        is_manager: true,
        mode_type: 'transaction',
        pool_checkout_timeout: 60_000,
        pool_size: 30,
        max_clients: 200,
      })
    })

    it('falls back to POSTGRES_PASSWORD when Supavisor returned no password', async () => {
      supavisorHolds({
        users: [{ db_user: 'postgres', is_manager: true, mode_type: 'transaction', pool_size: 20 }],
      })

      await updatePoolerConfig({ default_pool_size: 30 })

      const users = putBody().users as Record<string, unknown>[]
      expect(users[0].db_password).toBe(POSTGRES_PASSWORD)
    })

    it('moves the manager user’s pool size and leaves other users where they were', async () => {
      supavisorHolds({
        users: [
          {
            db_user: 'analytics',
            is_manager: false,
            mode_type: 'session',
            pool_size: 5,
            max_clients: 50,
            db_password: 'x',
          },
          {
            db_user: 'postgres',
            is_manager: true,
            mode_type: 'transaction',
            pool_size: 20,
            max_clients: 200,
            db_password: 'y',
          },
        ],
      })

      await updatePoolerConfig({ default_pool_size: 30, max_client_conn: 500 })

      const users = putBody().users as Record<string, unknown>[]
      expect(users[0]).toMatchObject({ db_user: 'analytics', pool_size: 5, max_clients: 50 })
      expect(users[1]).toMatchObject({ db_user: 'postgres', pool_size: 30, max_clients: 500 })
    })

    it('keeps the size it was not asked to change', async () => {
      supavisorHolds()

      await updatePoolerConfig({ default_pool_size: 30 })

      expect(putBody()).toMatchObject({ default_max_clients: 200 })
    })

    it('treats a cleared field as no change rather than as zero', async () => {
      supavisorHolds()

      await updatePoolerConfig({ default_pool_size: undefined, ignore_startup_parameters: '' })

      expect(putBody()).toMatchObject({ default_pool_size: 20, default_max_clients: 200 })
    })

    it('signs the PUT too', async () => {
      supavisorHolds()

      await updatePoolerConfig({ default_pool_size: 30 })

      const [header, claims, signature] = bearerOf(callsTo('PUT')[0]).split('.')
      expect(signature).toBe(
        createHmac('sha256', AUTH_JWT_SECRET).update(`${header}.${claims}`).digest('base64url')
      )
    })

    it('answers with the configuration as Supavisor now holds it', async () => {
      supavisorHolds()

      await expect(updatePoolerConfig({ default_pool_size: 30 })).resolves.toMatchObject({
        default_pool_size: 20,
        pgbouncer_enabled: true,
      })
    })

    describe('validation', () => {
      it.each([0, -1, 1001, 1.5, '20'])('refuses default_pool_size %p', async (value) => {
        supavisorHolds()

        await expect(updatePoolerConfig({ default_pool_size: value } as never)).rejects.toThrow(
          ServiceConfigValidationError
        )
        expect(callsTo('PUT')).toHaveLength(0)
      })

      it.each([0, -1, 10_001, 2.5])('refuses max_client_conn %p', async (value) => {
        supavisorHolds()

        await expect(updatePoolerConfig({ max_client_conn: value } as never)).rejects.toThrow(
          ServiceConfigValidationError
        )
        expect(callsTo('PUT')).toHaveLength(0)
      })

      it('accepts the ends of the range', async () => {
        supavisorHolds()

        await updatePoolerConfig({ default_pool_size: 1, max_client_conn: 10_000 })

        expect(putBody()).toMatchObject({ default_pool_size: 1, default_max_clients: 10_000 })
      })
    })
  })
})
