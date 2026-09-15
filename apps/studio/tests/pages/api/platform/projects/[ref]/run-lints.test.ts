import { createMocks } from 'node-mocks-http'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import handler from '../../../../../../pages/api/platform/projects/[ref]/run-lints'
import { DEFAULT_EXPOSED_SCHEMAS } from '@/lib/api/self-hosted/constants'
import { mswServer } from '@/tests/lib/msw'

vi.mock('@/lib/constants', () => ({
  IS_PLATFORM: false,
  API_URL: 'https://api.example.com',
  DOCS_URL: 'https://supabase.com/docs',
}))

const { getLints } = vi.hoisted(() => ({ getLints: vi.fn() }))
vi.mock('@/lib/api/self-hosted/lints', () => ({ getLints }))

// The schemas the lints run against come from the authenticator role rather than from
// PGRST_DB_SCHEMAS at import time, so a schema exposed from the settings page is linted.
const { executeQuery } = vi.hoisted(() => ({ executeQuery: vi.fn() }))
vi.mock('@/lib/api/self-hosted/query', () => ({ executeQuery }))

const withRoleSettings = (...settings: string[]) => {
  executeQuery.mockResolvedValue({
    data: settings.map((setting) => ({ setdatabase: 0, setting })),
    error: undefined,
  })
}

describe('/api/platform/projects/[ref]/run-lints', () => {
  beforeEach(() => {
    // The handler does not hit the network; disable MSW so unrelated unhandled-request errors don't fire.
    mswServer.close()
    getLints.mockReset()
    getLints.mockResolvedValue({ data: [], error: undefined })
    executeQuery.mockReset()
    withRoleSettings()
  })

  it.each(['POST', 'DELETE'] as const)('should return 405 for %s', async (method) => {
    const { req, res } = createMocks({ method, query: { ref: 'default' } })

    await handler(req, res)

    expect(res._getStatusCode()).toBe(405)
    expect(res.getHeader('Allow')).toEqual(['GET'])
  })

  it('lints the schemas the Data API exposes', async () => {
    withRoleSettings('pgrst.db_schemas=public,newly_exposed')

    const { req, res } = createMocks({ method: 'GET', query: { ref: 'default' } })
    await handler(req, res)

    expect(res._getStatusCode()).toBe(200)
    expect(getLints.mock.calls[0][0].exposedSchemas).toBe('public,newly_exposed')
  })

  it('falls back to the container env when the database cannot be reached', async () => {
    executeQuery.mockResolvedValue({ data: undefined, error: new Error('connection refused') })

    const { req, res } = createMocks({ method: 'GET', query: { ref: 'default' } })
    await handler(req, res)

    expect(res._getStatusCode()).toBe(200)
    expect(getLints.mock.calls[0][0].exposedSchemas).toBe(DEFAULT_EXPOSED_SCHEMAS)
  })

  it('answers 400 when the lints themselves fail', async () => {
    getLints.mockResolvedValue({ data: undefined, error: new Error('relation does not exist') })

    const { req, res } = createMocks({ method: 'GET', query: { ref: 'default' } })
    await handler(req, res)

    expect(res._getStatusCode()).toBe(400)
  })
})
